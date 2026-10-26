/**
 * Coordination backbone: the symmetric cross-view plane (Use-Coordination /
 * Vitessce CMV) over the workspace document's json-render `state` and the
 * dashboard elements' `$bindState` props (see `./types`).
 *
 *   - coordination TYPE: the parameter being shared (`focus`, `filter`, …).
 *   - named SCOPE: one cell of a type, `state[type][scope]`, addressed by the
 *     JSON Pointer `/<type>/<scope>`. Every element bound to the same pointer
 *     sees the same value, reactively, with no message passing.
 *
 * Writes validate against the type's Zod schema and replace the cell
 * (latest-wins). Agents reach the same cells through JSON Patch. Views ask
 * this module (`scopeOf`, `filterFacet`, `stateStore`) instead of reading
 * element bindings and `state` cells themselves. Binding and unbinding are
 * the `bind`/`unbind` edit ops (`workspace/edits.ts`), which own the binding
 * prop, the new scope's cell, and the filter clean-up; this port only runs them.
 */

import { getByPath, type StateStore } from "@json-render/core";
import type { FilterClause } from "@ndea/protocol";

import { elementScope, findElement, type LayoutDocument } from "../workspace/dashboard";
import type { DashboardEdit } from "../workspace/edits";
import {
  COORDINATION_TYPES,
  isCoordinationType,
  setFilterFacet,
  type CoordinationState,
  type CoordinationTypeId,
  type CoordinationValue,
} from "./types";

interface CoordinationDocumentState extends LayoutDocument {
  readonly state: CoordinationState;
}

interface CoordinationDocumentPort {
  snapshot(): CoordinationDocumentState;
  /** Replace the coordination cells (`state`); nothing else. */
  updateState(mutator: (state: CoordinationState) => CoordinationState): void;
  /** Run named edits: the only way bindings change. */
  apply(edits: readonly DashboardEdit[]): void;
  subscribe(listener: () => void): () => void;
}

export interface CoordinationScopeCellPort {
  assignScope(elementId: string, type: CoordinationTypeId, scope: string): void;
  clearScope(elementId: string, type: CoordinationTypeId): void;
  scopeOf(elementId: string, type: CoordinationTypeId): string | undefined;
  setCoordinationValue<T extends CoordinationTypeId>(type: T, scope: string, value: CoordinationValue<T>): void;
  readCoordination<T extends CoordinationTypeId>(type: T, scope: string): CoordinationValue<T> | undefined;
  subscribe<T extends CoordinationTypeId>(
    elementId: string,
    type: T,
    listener: (value: CoordinationValue<T> | undefined) => void,
  ): () => void;
  /** `elementId`'s own clause for `facet` in its filter scope; undefined when unbound or unset. */
  filterFacet(elementId: string, facet: string): FilterClause | undefined;
  /** Set (null clears) `elementId`'s `facet` in its filter scope; a no-op when unbound. */
  setFilterFacet(elementId: string, facet: string, clause: FilterClause | null): void;
  /** json-render's state: the cells at `/<type>/<scope>`, written through the type schemas. */
  readonly stateStore: StateStore;
}

function withCell(
  state: CoordinationState,
  type: CoordinationTypeId,
  scope: string,
  value: unknown,
): CoordinationState {
  return { ...state, [type]: { ...state[type], [scope]: value } };
}

class Coordination implements CoordinationScopeCellPort {
  private readonly document: CoordinationDocumentPort;

  readonly stateStore: StateStore = {
    get: (path) => getByPath(this.document.snapshot().state, path),
    set: (path, value) => this.setPath(path, value),
    update: (updates) => {
      for (const [path, value] of Object.entries(updates)) this.setPath(path, value);
    },
    getSnapshot: () => this.document.snapshot().state,
    subscribe: (listener) => this.document.subscribe(listener),
  };

  constructor(document: CoordinationDocumentPort) {
    this.document = document;
  }

  private setPath(path: string, value: unknown): void {
    const [, type, scope, ...rest] = path.split("/");
    if (!isCoordinationType(type) || !scope || rest.length > 0) {
      throw new Error(`dashboard state writes must target /<type>/<scope>, not "${path}"`);
    }
    this.setCoordinationValue(type, scope, value as never);
  }

  /** Bind an element to a scope (`bind`); a no-op when it already binds that scope or does not exist. */
  assignScope(elementId: string, type: CoordinationTypeId, scope: string): void {
    const element = findElement(this.document.snapshot(), elementId);
    if (!element || elementScope(element, type) === scope) return;
    this.document.apply([{ op: "bind", id: elementId, type, scope }]);
  }

  /** Unbind an element from one type (`unbind`; it stops participating); a no-op when it is not bound. */
  clearScope(elementId: string, type: CoordinationTypeId): void {
    const element = findElement(this.document.snapshot(), elementId);
    if (!element || !(type in element.props)) return;
    this.document.apply([{ op: "unbind", id: elementId, type }]);
  }

  scopeOf(elementId: string, type: CoordinationTypeId): string | undefined {
    return elementScope(findElement(this.document.snapshot(), elementId), type);
  }

  setCoordinationValue<T extends CoordinationTypeId>(type: T, scope: string, value: CoordinationValue<T>): void {
    if (!COORDINATION_TYPES[type].value.safeParse(value).success) {
      throw new TypeError(`coordination cell "/${type}/${scope}" failed validation`);
    }
    this.document.updateState((state) => withCell(state, type, scope, value));
  }

  readCoordination<T extends CoordinationTypeId>(type: T, scope: string): CoordinationValue<T> | undefined {
    return this.document.snapshot().state[type]?.[scope];
  }

  filterFacet(elementId: string, facet: string): FilterClause | undefined {
    const scope = this.scopeOf(elementId, "filter");
    return scope === undefined ? undefined : this.readCoordination("filter", scope)?.[elementId]?.[facet];
  }

  setFilterFacet(elementId: string, facet: string, clause: FilterClause | null): void {
    const scope = this.scopeOf(elementId, "filter");
    if (scope === undefined) return;
    const cell = this.readCoordination("filter", scope) ?? {};
    const next = setFilterFacet(cell, elementId, facet, clause);
    if (next !== cell) this.setCoordinationValue("filter", scope, next);
  }

  /**
   * Subscribe to an element's resolved cell for one type. Fires only when the
   * effective value's reference changes (rebinding or a cell write), so writes
   * to unrelated scopes never wake this subscriber. Emits `undefined` when
   * the element is unbound.
   */
  subscribe<T extends CoordinationTypeId>(
    elementId: string,
    type: T,
    cb: (value: CoordinationValue<T> | undefined) => void,
  ): () => void {
    const effective = (): CoordinationValue<T> | undefined => {
      const scope = this.scopeOf(elementId, type);
      return scope === undefined ? undefined : this.readCoordination(type, scope);
    };
    let last = effective();
    return this.document.subscribe(() => {
      const v = effective();
      if (v !== last) {
        last = v;
        cb(v);
      }
    });
  }
}

export function createCoordination(document: CoordinationDocumentPort): CoordinationScopeCellPort {
  return new Coordination(document);
}
