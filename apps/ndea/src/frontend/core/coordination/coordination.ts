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
 * (latest-wins). Agents reach the same cells through JSON Patch.
 */

import type { Store } from "@tanstack/store";

import { elementScope, setElementProps, type Dashboard } from "../workspace/dashboard";
import {
  bindingPointer,
  COORDINATION_TYPES,
  type CoordinationState,
  type CoordinationTypeId,
  type CoordinationValue,
} from "./types";

export interface CoordinationDocumentState {
  readonly state: CoordinationState;
  readonly spec: Dashboard;
}

export interface CoordinationDocumentPort {
  snapshot(): CoordinationDocumentState;
  update(mutator: (state: CoordinationDocumentState) => CoordinationDocumentState): void;
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
}

/** Adapts a document store without exposing its concrete state to coordination. */
export function coordinationDocumentPort<S extends CoordinationDocumentState>(
  store: Store<S>,
): CoordinationDocumentPort {
  return {
    snapshot: () => store.state,
    update(mutator) {
      store.setState((state) => mutator(state) as S);
    },
    subscribe(listener) {
      const subscription = store.subscribe(listener);
      return () => subscription.unsubscribe();
    },
  };
}

function withCell(
  state: CoordinationState,
  type: CoordinationTypeId,
  scope: string,
  value: unknown,
): CoordinationState {
  return { ...state, [type]: { ...state[type], [scope]: value } };
}

/** Drop an element's crossfilter contribution from a filter scope; peers stop seeing it. */
function withoutFilterContribution(state: CoordinationState, scope: string | undefined, elementId: string) {
  const cell = scope === undefined ? undefined : state.filter?.[scope];
  if (!cell || !(elementId in cell)) return state;
  const { [elementId]: _dropped, ...rest } = cell;
  return withCell(state, "filter", scope!, rest);
}

/** Drop the filter contributions of elements no longer in `next`, so peers stop seeing them. */
export function withoutRemovedContributions<S extends CoordinationDocumentState>(previous: S, next: S): S {
  let state = next.state;
  for (const [id, element] of Object.entries(previous.spec.elements)) {
    if (next.spec.elements[id]) continue;
    state = withoutFilterContribution(state, elementScope(element, "filter"), id);
  }
  return state === next.state ? next : { ...next, state };
}

class Coordination implements CoordinationScopeCellPort {
  private readonly document: CoordinationDocumentPort;

  constructor(document: CoordinationDocumentPort) {
    this.document = document;
  }

  /** Bind an element to a scope, seeding the cell with the type's default when it does not exist yet. */
  assignScope(elementId: string, type: CoordinationTypeId, scope: string): void {
    this.document.update((s) => {
      const previous = elementScope(s.spec.elements[elementId], type);
      if (previous === scope || !s.spec.elements[elementId]) return s;
      let state = type === "filter" ? withoutFilterContribution(s.state, previous, elementId) : s.state;
      if (state[type]?.[scope] === undefined)
        state = withCell(state, type, scope, COORDINATION_TYPES[type].defaultValue);
      const spec = setElementProps(s.spec, elementId, { [type]: { $bindState: bindingPointer(type, scope) } });
      return { ...s, state, spec };
    });
  }

  /** Unbind an element from one type (it stops participating in that type). */
  clearScope(elementId: string, type: CoordinationTypeId): void {
    this.document.update((s) => {
      const element = s.spec.elements[elementId];
      if (!element || !(type in element.props)) return s;
      const state =
        type === "filter" ? withoutFilterContribution(s.state, elementScope(element, type), elementId) : s.state;
      return { ...s, state, spec: setElementProps(s.spec, elementId, { [type]: undefined }) };
    });
  }

  scopeOf(elementId: string, type: CoordinationTypeId): string | undefined {
    return elementScope(this.document.snapshot().spec.elements[elementId], type);
  }

  setCoordinationValue<T extends CoordinationTypeId>(type: T, scope: string, value: CoordinationValue<T>): void {
    if (!COORDINATION_TYPES[type].value.safeParse(value).success) {
      throw new TypeError(`coordination cell "/${type}/${scope}" failed validation`);
    }
    this.document.update((s) => ({ ...s, state: withCell(s.state, type, scope, value) }));
  }

  readCoordination<T extends CoordinationTypeId>(type: T, scope: string): CoordinationValue<T> | undefined {
    return this.document.snapshot().state[type]?.[scope];
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
