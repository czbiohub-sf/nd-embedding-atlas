/**
 * Coordination backbone — the symmetric cross-view plane (Boukhelifa
 * identity-of-reference / Vitessce CMV), rolled own over the workspace
 * TanStack store (KD1; no foreign provider).
 *
 * Two axes:
 *   - coordination TYPE — the parameter being shared (`focus`, later
 *     `viewSync`/`ordering`).
 *   - named SCOPE — a named cell of a type (e.g. `focus.A`). N nodes that
 *     reference the same (type, scope) see the same value, reactively, with no
 *     edge and no message passing.
 *
 * Storage lives in two `WsState` fields:
 *   - `coordinationScopes[nodeId][type] = scope` — which cell a node references.
 *   - `coordinationSpace[type][scope] = value` — the live cell value.
 *
 * Conflict policy is latest-wins per writer: a cell holds one JsonValue, the
 * most recent `set` replaces it, no merge. Scope values are `JsonValue`-only
 * (KD3) so share/undo/persist hold.
 *
 * For the U1 spike the only registered type is `focus`; the
 * `defineCoordinationType` registry is extracted in U3.
 */

import { z } from "zod";
import type { Store } from "@tanstack/store";

import type { JsonValue } from "@ndea/sdk";
import type { WsState } from "@/core/workspace/types";
import { defineCoordinationType, defineGroupChannel } from "./define-type";

/* ── registered coordination types ───────────────────────────────────────
 * focus (U1) + viewSync (U2) re-expressed through the extracted primitive,
 * plus `ordering` (U3) registered through the SAME API to prove a third type
 * needs no backbone changes. Registration is a module side effect — importing
 * this file (which the Workspace does) populates the registry. */

/** `focus` — a shared obs id among the scope's members (group channel). */
export const FOCUS_TYPE = defineGroupChannel({
  type: "focus",
  capability: "focus-coordination",
  hostFacet: "focus",
});

/** `viewSync` — shared pan/zoom; `src` is the broadcaster (self-skip). */
export const VIEW_SYNC_TYPE = defineCoordinationType({
  type: "viewSync",
  schema: z.object({ panX: z.number(), panY: z.number(), zoom: z.number(), src: z.string().optional() }),
  defaultValue: { panX: 0, panY: 0, zoom: 1 },
  capability: "view-coordination",
  hostFacet: "viewCoordination",
});

/** `ordering` — shared sort column + direction (table). The third type. */
export const ORDERING_TYPE = defineCoordinationType({
  type: "ordering",
  schema: z.object({ col: z.string(), dir: z.enum(["asc", "desc"]) }).nullable(),
  defaultValue: null,
  capability: "ordering-coordination",
  hostFacet: "ordering",
});

/** Small distinct palette (kept off the feedback teal). */
const SYNC_PALETTE = ["#c084fc", "#38bdf8", "#fb7185", "#fbbf24", "#34d399"];

/** Stable scope color from the 31× string hash. Hashes the scope name ALONE so
 *  a migrated v1 group id ("A") keeps its exact color (no badge drift). */
export function scopeColor(scope: string): string {
  let h = 0;
  for (let i = 0; i < scope.length; i++) h = (h * 31 + scope.charCodeAt(i)) >>> 0;
  return SYNC_PALETTE[h % SYNC_PALETTE.length];
}

/**
 * The resolve/notify backbone over a `Store<WsState>`. Mutations go through
 * `store.setState`; reads are live off `store.state`. Held once on the
 * Workspace as `ws.coordination` and reached from nodes only via the `host`
 * seam (the body-dock Proxy), never imported into `nodes/**`.
 */
export class Coordination {
  private seq = 0;
  private readonly store: Store<WsState>;

  constructor(store: Store<WsState>) {
    this.store = store;
  }

  /* ── scope assignment (which cell a node references) ──────────────── */

  /** Assign a node to a named scope of a coordination type. */
  assignScope(nodeId: string, type: string, scope: string): void {
    this.store.setState((s) => ({
      ...s,
      coordinationScopes: {
        ...s.coordinationScopes,
        [nodeId]: { ...s.coordinationScopes[nodeId], [type]: scope },
      },
    }));
  }

  /** Drop a node's scope for one type (it stops participating in that type). */
  clearScope(nodeId: string, type: string): void {
    this.store.setState((s) => {
      const cur = s.coordinationScopes[nodeId];
      if (!cur || !(type in cur)) return s;
      const next = { ...cur };
      delete next[type];
      const coordinationScopes = { ...s.coordinationScopes };
      if (Object.keys(next).length > 0) coordinationScopes[nodeId] = next;
      else delete coordinationScopes[nodeId];
      return { ...s, coordinationScopes };
    });
  }

  /** The scope a node references for a type, or undefined if unassigned. */
  scopeOf(nodeId: string, type: string): string | undefined {
    return this.store.state.coordinationScopes[nodeId]?.[type];
  }

  /** Mint a fresh, unused scope name for a type. Picker (U4) uses this for
   *  "New scope"; the U1 UI still hardcodes "A". */
  mintScope(type: string): string {
    const used = new Set<string>();
    for (const byType of Object.values(this.store.state.coordinationScopes)) {
      if (byType[type]) used.add(byType[type]);
    }
    for (let i = 0; i < 26; i++) {
      const name = String.fromCharCode(65 + i); // A..Z
      if (!used.has(name)) return name;
    }
    return `s${++this.seq}`;
  }

  /* ── cell values (the shared, latest-wins parameter) ──────────────── */

  /** Write a cell value (latest-wins — replaces, never merges). */
  setCoordinationValue(type: string, scope: string, value: JsonValue): void {
    this.store.setState((s) => ({
      ...s,
      coordinationSpace: {
        ...s.coordinationSpace,
        [type]: { ...s.coordinationSpace[type], [scope]: value },
      },
    }));
  }

  /** Read a cell value, or undefined if no value has been written yet. */
  readCoordination(type: string, scope: string): JsonValue | undefined {
    return this.store.state.coordinationSpace[type]?.[scope];
  }

  /** The scope names that currently EXIST for a type — every scope referenced by
   *  some node, unioned with any cell already in the space. The picker offers
   *  these (plus mint-new) so a node can never reference a dangling scope (KD9). */
  existingScopes(type: string): string[] {
    const out = new Set<string>();
    for (const byType of Object.values(this.store.state.coordinationScopes)) {
      if (byType[type]) out.add(byType[type]);
    }
    for (const scope of Object.keys(this.store.state.coordinationSpace[type] ?? {})) out.add(scope);
    return [...out].toSorted();
  }

  /** Reverse index: the node ids referencing (type, scope). Computed on demand
   *  from `coordinationScopes` — O(nodes), only walked on a set/subscribe. */
  nodesInScope(type: string, scope: string): string[] {
    const out: string[] = [];
    for (const [nodeId, byType] of Object.entries(this.store.state.coordinationScopes)) {
      if (byType[type] === scope) out.push(nodeId);
    }
    return out;
  }

  /** Stable color for a scope (see {@link scopeColor}). */
  scopeColor(scope: string): string {
    return scopeColor(scope);
  }

  /* ── reactivity (selector-scoped per (node, type); KD5) ───────────── */

  /**
   * Subscribe to a node's RESOLVED cell for one type. `cb` fires only when the
   * effective value changes — the node's scope flipping (assign/clear) or its
   * cell value moving. A whole-store listener gated by an effective-value diff,
   * so a write to an unrelated scope/type never wakes this subscriber (the CMV
   * render-storm guard). Returns an unsubscribe fn.
   * Emits `undefined` for unassigned nodes; the body-dock seam applies fallback.
   */
  subscribe(nodeId: string, type: string, cb: (value: JsonValue | undefined) => void): () => void {
    const effective = (): JsonValue | undefined => {
      const scope = this.scopeOf(nodeId, type);
      return scope === undefined ? undefined : this.readCoordination(type, scope);
    };
    let last = effective();
    const sub = this.store.subscribe(() => {
      const v = effective();
      if (v !== last) {
        last = v;
        cb(v);
      }
    });
    return () => sub.unsubscribe();
  }
}
