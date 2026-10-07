/**
 * Coordination backbone: the symmetric cross-view plane (Use-Coordination /
 * Vitessce CMV), rolled own over the workspace document's json-render-style
 * `state` and `bindings` sections (see `./types`).
 *
 *   - coordination TYPE: the parameter being shared (`focus`, `filter`, …).
 *   - named SCOPE: one cell of a type, `state[type][scope]`, addressed by the
 *     JSON Pointer `/<type>/<scope>`. Every node bound to the same pointer sees
 *     the same value, reactively, with no edge and no message passing.
 *
 * Writes validate against the type's Zod schema and replace the cell
 * (latest-wins). Agents reach the same cells through JSON Patch.
 */

import type { Store } from "@tanstack/store";

import { SCOPE_PALETTE } from "@/lib/color/brand";
import {
  bindingPointer,
  bindingScope,
  COORDINATION_TYPES,
  type CoordinationBindings,
  type CoordinationState,
  type CoordinationTypeId,
  type CoordinationValue,
} from "./types";

export interface CoordinationDocumentState {
  readonly state: CoordinationState;
  readonly bindings: CoordinationBindings;
}

export interface CoordinationDocumentPort {
  snapshot(): CoordinationDocumentState;
  update(mutator: (state: CoordinationDocumentState) => CoordinationDocumentState): void;
  subscribe(listener: () => void): () => void;
}

export interface CoordinationScopeCellPort {
  assignScope(nodeId: string, type: CoordinationTypeId, scope: string): void;
  clearScope(nodeId: string, type: CoordinationTypeId): void;
  scopeOf(nodeId: string, type: CoordinationTypeId): string | undefined;
  mintScope(type: CoordinationTypeId): string;
  setCoordinationValue<T extends CoordinationTypeId>(type: T, scope: string, value: CoordinationValue<T>): void;
  readCoordination<T extends CoordinationTypeId>(type: T, scope: string): CoordinationValue<T> | undefined;
  existingScopes(type: CoordinationTypeId): string[];
  scopeColor(scope: string): string;
  subscribeScope(nodeId: string, type: CoordinationTypeId, listener: (scope: string | undefined) => void): () => void;
  subscribe<T extends CoordinationTypeId>(
    nodeId: string,
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

/** Stable scope color from the 31× string hash of the scope name. */
export function scopeColor(scope: string): string {
  let h = 0;
  for (let i = 0; i < scope.length; i++) h = (h * 31 + scope.charCodeAt(i)) >>> 0;
  return SCOPE_PALETTE[h % SCOPE_PALETTE.length];
}

function withCell(
  state: CoordinationState,
  type: CoordinationTypeId,
  scope: string,
  value: unknown,
): CoordinationState {
  return { ...state, [type]: { ...state[type], [scope]: value } };
}

/** Drop a node's crossfilter contribution from a filter scope; peers stop seeing it. */
function withoutFilterContribution(state: CoordinationState, scope: string | undefined, nodeId: string) {
  const cell = scope === undefined ? undefined : state.filter?.[scope];
  if (!cell || !(nodeId in cell)) return state;
  const { [nodeId]: _dropped, ...rest } = cell;
  return withCell(state, "filter", scope!, rest);
}

/** Remove a deleted node's bindings and filter contributions. */
export function withoutNodeCoordination<S extends CoordinationDocumentState>(document: S, nodeId: string): S {
  const { [nodeId]: byType, ...bindings } = document.bindings;
  return {
    ...document,
    bindings,
    state: withoutFilterContribution(document.state, bindingScope("filter", byType?.filter), nodeId),
  };
}

class Coordination implements CoordinationScopeCellPort {
  private seq = 0;
  private readonly document: CoordinationDocumentPort;

  constructor(document: CoordinationDocumentPort) {
    this.document = document;
  }

  /** Bind a node to a scope, seeding the cell with the type's default when it does not exist yet. */
  assignScope(nodeId: string, type: CoordinationTypeId, scope: string): void {
    this.document.update((s) => {
      const previous = bindingScope(type, s.bindings[nodeId]?.[type]);
      if (previous === scope) return s;
      let state = type === "filter" ? withoutFilterContribution(s.state, previous, nodeId) : s.state;
      if (state[type]?.[scope] === undefined)
        state = withCell(state, type, scope, COORDINATION_TYPES[type].defaultValue);
      return {
        ...s,
        state,
        bindings: {
          ...s.bindings,
          [nodeId]: { ...s.bindings[nodeId], [type]: { $bindState: bindingPointer(type, scope) } },
        },
      };
    });
  }

  /** Unbind a node from one type (it stops participating in that type). */
  clearScope(nodeId: string, type: CoordinationTypeId): void {
    this.document.update((s) => {
      const current = s.bindings[nodeId];
      if (!current?.[type]) return s;
      const { [type]: _dropped, ...rest } = current;
      const bindings = { ...s.bindings };
      if (Object.keys(rest).length > 0) bindings[nodeId] = rest;
      else delete bindings[nodeId];
      const state =
        type === "filter" ? withoutFilterContribution(s.state, bindingScope(type, current.filter), nodeId) : s.state;
      return { ...s, state, bindings };
    });
  }

  scopeOf(nodeId: string, type: CoordinationTypeId): string | undefined {
    return bindingScope(type, this.document.snapshot().bindings[nodeId]?.[type]);
  }

  /** Mint a fresh, unused scope name (A..Z, then s1, s2, …). */
  mintScope(type: CoordinationTypeId): string {
    const used = new Set(this.existingScopes(type));
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i);
      if (!used.has(name)) return name;
    }
    while (used.has(`s${++this.seq}`));
    return `s${this.seq}`;
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

  /** Scopes that exist for a type: every bound scope plus every cell in state. */
  existingScopes(type: CoordinationTypeId): string[] {
    const { state, bindings } = this.document.snapshot();
    const out = new Set(Object.keys(state[type] ?? {}));
    for (const byType of Object.values(bindings)) {
      const scope = bindingScope(type, byType[type]);
      if (scope !== undefined) out.add(scope);
    }
    return [...out].toSorted();
  }

  scopeColor(scope: string): string {
    return scopeColor(scope);
  }

  /**
   * Subscribe to a node's resolved cell for one type. Fires only when the
   * effective value's reference changes (rebinding or a cell write), so writes
   * to unrelated scopes never wake this subscriber. Emits `undefined` when
   * the node is unbound.
   */
  subscribe<T extends CoordinationTypeId>(
    nodeId: string,
    type: T,
    cb: (value: CoordinationValue<T> | undefined) => void,
  ): () => void {
    const effective = (): CoordinationValue<T> | undefined => {
      const scope = this.scopeOf(nodeId, type);
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

  subscribeScope(nodeId: string, type: CoordinationTypeId, cb: (scope: string | undefined) => void): () => void {
    let last = this.scopeOf(nodeId, type);
    return this.document.subscribe(() => {
      const scope = this.scopeOf(nodeId, type);
      if (scope === last) return;
      last = scope;
      cb(scope);
    });
  }
}

export function createCoordination(document: CoordinationDocumentPort): CoordinationScopeCellPort {
  return new Coordination(document);
}
