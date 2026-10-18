/**
 * Live view bodies for the dashboard: one runtime per view element, keyed by
 * element id. A body's config is its element's component props; its predicate
 * is the element's data source AND the other members of its filter scope
 * (`elementPredicate`), the same SQL the server evaluates.
 */

import { Store } from "@tanstack/store";
import type {
  ColorCoordinationAPI,
  FocusCoordinationAPI,
  JsonValue,
  OrderingCoordinationAPI,
  RowIndex,
  ViewCoordinationAPI,
} from "@ndea/sdk";

import { createFilterBinding } from "@/core/coordination/filter-binding";
import { COORDINATION_TYPES, type CoordinationTypeId, type CoordinationValue } from "@/core/coordination/types";
import { COMPONENT_DEFINITIONS, type AnyComponentDefinition } from "@/core/component/definitions";
import { componentProps, type DashboardElement } from "@/core/workspace/dashboard";
import type { WorkspaceStore } from "@/core/workspace/workspace-store";
import { createComponentHost, type ComponentHostDependencies, type HostHandle } from "./host";
import { ComponentRuntime } from "./instance-runtime";

const VIEW_COORDINATION_LOCK = "lock1";

/** The slice of `WorkspaceStore` the runtimes read and write. */
export type ElementRuntimeSession = Pick<
  WorkspaceStore,
  "element" | "elementPredicate" | "subscribe" | "coordination" | "setElementProps"
>;

export interface ElementRuntimeManagerDependencies {
  readonly session: ElementRuntimeSession;
  readonly appHost: Readonly<ComponentHostDependencies>;
}

/** The element's bound cell of one coordination type; reads `undefined` and drops writes when unbound. */
function boundCell<T extends CoordinationTypeId>(session: ElementRuntimeSession, id: string, type: T) {
  const scope = () => session.coordination.scopeOf(id, type);
  return {
    scope,
    read(): CoordinationValue<T> | undefined {
      const current = scope();
      return current === undefined ? undefined : session.coordination.readCoordination(type, current);
    },
    write(value: CoordinationValue<T>): void {
      const current = scope();
      if (current !== undefined) session.coordination.setCoordinationValue(type, current, value);
    },
    subscribe: (callback: (value: CoordinationValue<T> | undefined) => void) =>
      session.coordination.subscribe(id, type, callback),
  };
}

function createViewCoordination(session: ElementRuntimeSession, id: string): ViewCoordinationAPI {
  const cell = boundCell(session, id, "viewSync");
  return {
    get panX() {
      return cell.read()?.panX ?? 0;
    },
    get panY() {
      return cell.read()?.panY ?? 0;
    },
    get zoom() {
      return cell.read()?.zoom ?? 1;
    },
    get linked() {
      return cell.scope() !== undefined;
    },
    broadcast(state) {
      // A 3D (turntable) write keeps the cell's 2D view; a 2D write replaces the cell.
      const { panX, panY, zoom } = cell.read() ?? COORDINATION_TYPES.viewSync.defaultValue;
      cell.write({ panX, panY, zoom, ...state, src: id });
    },
    toggleLock() {
      if (cell.scope() !== undefined) session.coordination.clearScope(id, "viewSync");
      else session.coordination.assignScope(id, "viewSync", VIEW_COORDINATION_LOCK);
    },
    subscribe(callback) {
      return cell.subscribe((value) => {
        if (!value || value.src === id) return;
        const { src: _src, ...state } = value;
        callback(state);
      });
    },
  };
}

function createOrderingCoordination(session: ElementRuntimeSession, id: string): OrderingCoordinationAPI {
  const cell = boundCell(session, id, "ordering");
  return {
    get: () => cell.read() ?? null,
    set: cell.write,
    subscribe: (callback) => cell.subscribe((value) => callback(value ?? null)),
  };
}

function createColorCoordination(session: ElementRuntimeSession, id: string): ColorCoordinationAPI {
  const cell = boundCell(session, id, "colorBy");
  return {
    get linked() {
      return cell.scope() !== undefined;
    },
    get: () => cell.read() ?? null,
    set: cell.write,
    subscribe: (callback) => cell.subscribe((value) => callback(value ?? null)),
  };
}

/** Bound: the scope's shared row. Unbound: this element's own focus. */
function createFocusCoordination(session: ElementRuntimeSession, id: string): FocusCoordinationAPI {
  const cell = boundCell(session, id, "focus");
  const local = new Store<RowIndex | null>(null);
  const read = (): RowIndex | null =>
    cell.scope() === undefined ? local.state : ((cell.read() ?? null) as RowIndex | null);
  return {
    get: read,
    set(rowIndex) {
      if (cell.scope() === undefined) local.setState(() => rowIndex);
      else cell.write(rowIndex);
    },
    subscribe(callback) {
      let previous = read();
      const emitChange = () => {
        const value = read();
        if (value === previous) return;
        previous = value;
        callback(value);
      };
      const localSubscription = local.subscribe(emitChange);
      const cellSubscription = cell.subscribe(emitChange);
      return () => {
        localSubscription.unsubscribe();
        cellSubscription();
      };
    },
  };
}

const configKey = (element: DashboardElement | undefined): string | undefined =>
  element ? JSON.stringify(componentProps(element)) : undefined;

interface LiveElement {
  readonly type: string;
  runtime: ComponentRuntime;
  /** The config this body last saw: mount-time or its own `patchConfig`. */
  config: string | undefined;
}

/** Owns every live view body and its stable body/header dock elements. */
export class ComponentRuntimeManager {
  private readonly dependencies: ElementRuntimeManagerDependencies;
  private readonly live = new Map<string, LiveElement>();
  private readonly bodyDocks = new Map<string, HTMLDivElement>();
  private readonly headerDocks = new Map<string, HTMLDivElement>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeDocument: () => void;
  private disposed = false;

  constructor(dependencies: ElementRuntimeManagerDependencies) {
    this.dependencies = dependencies;
    this.unsubscribeDocument = dependencies.session.subscribe(() => this.reconcile());
  }

  /** Fires when a runtime is created, replaced, or removed. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  bodyDock(id: string): HTMLDivElement {
    return this.dock(
      this.bodyDocks,
      id,
      "nd-body-dock",
      "display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;height:100%;width:100%;",
    );
  }

  headerDock(id: string): HTMLDivElement {
    return this.dock(
      this.headerDocks,
      id,
      "nd-header-dock",
      "display:flex;align-items:center;flex:1;min-width:0;height:100%;overflow:hidden;container-type:inline-size;line-height:1;",
    );
  }

  private dock(docks: Map<string, HTMLDivElement>, id: string, className: string, css: string): HTMLDivElement {
    this.assertLive();
    let element = docks.get(id);
    if (!element) {
      element = document.createElement("div");
      element.className = className;
      element.style.cssText = css;
      docks.set(id, element);
    }
    return element;
  }

  /** The element's runtime, started on first use. Undefined for non-view elements. */
  activate(id: string): ComponentRuntime | undefined {
    this.assertLive();
    const existing = this.live.get(id);
    if (existing) return existing.runtime;
    const element = this.dependencies.session.element(id);
    const definition = element ? COMPONENT_DEFINITIONS[element.type] : undefined;
    if (!element || !definition) return undefined;
    const entry: LiveElement = { type: element.type, runtime: this.start(id, definition), config: undefined };
    entry.config = configKey(this.dependencies.session.element(id));
    this.live.set(id, entry);
    this.emit();
    return entry.runtime;
  }

  get(id: string): ComponentRuntime | undefined {
    return this.live.get(id)?.runtime;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDocument();
    const errors: unknown[] = [];
    for (const id of this.live.keys()) {
      try {
        this.stop(id);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const element of [...this.bodyDocks.values(), ...this.headerDocks.values()]) element.remove();
    this.bodyDocks.clear();
    this.headerDocks.clear();
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "component runtime disposal failed");
  }

  private start(id: string, definition: AnyComponentDefinition): ComponentRuntime {
    const runtime = new ComponentRuntime({
      definition,
      dockElement: this.bodyDock(id),
      createHost: (resolved) => this.createHost(id, resolved),
    });
    void runtime.start();
    return runtime;
  }

  private stop(id: string): void {
    const entry = this.live.get(id);
    if (!entry) return;
    this.live.delete(id);
    entry.runtime.dispose();
  }

  /**
   * Removed or retyped elements dispose; a config another writer changed (an
   * agent, a remote revision) restarts the body so it reads the new props.
   */
  private reconcile(): void {
    const { session } = this.dependencies;
    let changed = false;
    // Deleting the current entry while iterating a Map is safe.
    for (const [id, entry] of this.live) {
      const element = session.element(id);
      if (!element || element.type !== entry.type) {
        this.stop(id);
        for (const docks of [this.bodyDocks, this.headerDocks]) {
          docks.get(id)?.remove();
          docks.delete(id);
        }
        changed = true;
        continue;
      }
      const config = configKey(element);
      if (config === entry.config) continue;
      entry.runtime.dispose();
      entry.runtime = this.start(id, COMPONENT_DEFINITIONS[element.type]);
      entry.config = config;
      changed = true;
    }
    if (changed) this.emit();
  }

  private createHost(id: string, definition: AnyComponentDefinition): HostHandle<unknown> {
    const { session, appHost } = this.dependencies;
    const element = session.element(id);
    if (!element) throw new Error(`dashboard element not found: ${id}`);
    const filter = createFilterBinding({
      elementId: id,
      coordination: session.coordination,
      coordinator: appHost.coordinator,
      table: appHost.table,
    });

    const handle = createComponentHost(appHost, {
      elementId: id,
      type: definition.type,
      config: componentProps(element),
      bodyHeaderElement: this.headerDock(id),
      predicate: filter.selection,
      focus: createFocusCoordination(session, id),
      viewSync: createViewCoordination(session, id),
      ordering: createOrderingCoordination(session, id),
      colorBy: createColorCoordination(session, id),
      filter,
      patchConfig: (patch) => {
        const entry = this.live.get(id);
        const current = session.element(id);
        if (!current) return;
        // Own writes do not restart the body: record them before they land.
        const props = patch as Record<string, JsonValue>;
        if (entry) entry.config = configKey({ ...current, props: { ...current.props, ...props } });
        session.setElementProps(id, props);
      },
    });
    handle.host.track(() => filter.dispose());

    let predicate: string | null | undefined;
    const sync = () => {
      const next = session.elementPredicate(id);
      if (next === predicate) return;
      predicate = next;
      filter.setPredicate(next);
    };
    handle.host.track(session.subscribe(sync));
    sync();
    return handle;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("component runtime manager is disposed");
  }
}
