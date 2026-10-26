/**
 * Live view bodies for the dashboard: one runtime per view element, keyed by
 * element id. A body's config is its element's component props with
 * expressions (`$template`, `$state`: `coordination/expressions.ts`) resolved against the
 * coordination `state`; its predicate is the element's data source AND the
 * other members of its filter scope (`elementPredicate`), the same SQL the
 * server evaluates.
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

import { resolveExpressions } from "@/core/coordination/expressions";
import { createFilterBinding } from "@/core/coordination/filter-binding";
import {
  COORDINATION_TYPES,
  type CoordinationState,
  type CoordinationTypeId,
  type CoordinationValue,
} from "@/core/coordination/types";
import { COMPONENT_DEFINITIONS, type AnyComponentDefinition } from "@/core/component/definitions";
import { componentProps, type DashboardElement } from "@/core/workspace/dashboard";
import type { WorkspaceStore } from "@/core/workspace/workspace-store";
import { createComponentHost, type ComponentHostDependencies, type HostHandle } from "./host";
import { ComponentRuntime } from "./instance-runtime";

const VIEW_COORDINATION_LOCK = "lock1";

/** The slice of `WorkspaceStore` the runtimes read and write. */
export type ElementRuntimeSession = Pick<
  WorkspaceStore,
  "element" | "elementPredicate" | "subscribe" | "coordination" | "apply" | "snapshot"
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

/** The config a body sees: its component props, expressions resolved against the coordination cells. */
const bodyConfig = (element: DashboardElement, state: CoordinationState): Record<string, JsonValue> =>
  resolveExpressions(componentProps(element), state) as Record<string, JsonValue>;

const configKey = (element: DashboardElement | undefined, state: CoordinationState): string | undefined =>
  element ? JSON.stringify(bodyConfig(element, state)) : undefined;

interface LiveElement {
  readonly type: string;
  runtime: ComponentRuntime;
  /** The config this body last saw: mount-time or its own `patchConfig`. */
  config: string | undefined;
}

/** Owns every live view body and its stable body dock element. */
export class ComponentRuntimeManager {
  private readonly dependencies: ElementRuntimeManagerDependencies;
  private readonly live = new Map<string, LiveElement>();
  private readonly bodyDocks = new Map<string, HTMLDivElement>();
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
    this.assertLive();
    let element = this.bodyDocks.get(id);
    if (!element) {
      element = document.createElement("div");
      element.className = "nd-body-dock";
      element.style.cssText =
        "display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;height:100%;width:100%;";
      this.bodyDocks.set(id, element);
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
    entry.config = configKey(this.dependencies.session.element(id), this.dependencies.session.snapshot().state);
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
    for (const element of this.bodyDocks.values()) element.remove();
    this.bodyDocks.clear();
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
   * Removed or retyped elements, and views outside the active layout, dispose
   * (a switch back starts them again); a config another writer changed (an
   * agent, a remote revision) restarts the body so it reads the new props.
   */
  private reconcile(): void {
    const { session } = this.dependencies;
    const { layouts, layout, state } = session.snapshot();
    const shown = layouts[layout].spec.elements;
    let changed = false;
    // Deleting the current entry while iterating a Map is safe.
    for (const [id, entry] of this.live) {
      const element = Object.hasOwn(shown, id) ? shown[id] : undefined;
      if (!element || element.type !== entry.type) {
        this.stop(id);
        this.bodyDocks.get(id)?.remove();
        this.bodyDocks.delete(id);
        changed = true;
        continue;
      }
      const config = configKey(element, state);
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
      config: bodyConfig(element, session.snapshot().state),
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
        // Own writes do not restart the body: record them before they land (`set_props`: null removes a key).
        const props = patch as Record<string, JsonValue>;
        const next = { ...current.props, ...props };
        for (const [key, value] of Object.entries(props)) if (value === null) delete next[key];
        if (entry) entry.config = configKey({ ...current, props: next }, session.snapshot().state);
        session.apply([{ op: "set_props", id, props }]);
      },
      saveSource: (baseName, where) => {
        const { data } = session.snapshot();
        let n = 1;
        while (data[`${baseName}-${n}`]) n++;
        const name = `${baseName}-${n}`;
        session.apply([{ op: "set_data", name, source: { where } }]);
        return name;
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
