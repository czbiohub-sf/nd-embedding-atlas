/**
 * Persistence foundation (evolutionary-node-design U7) — the versioned document
 * shape + the validation hook a future save/load path runs through.
 *
 * Save/load/rehydrate plumbing itself is deferred to its own plan. This lands
 * the architecture so adding it later is trivial AND safe: the document is
 * versioned from day one (the migration anchor), and every persisted node
 * config is validated against its spec schema before it re-enters the live
 * graph — the brainstorm's "saved docs never load into corrupt state" guarantee.
 */

import type { JsonValue } from "@/core/node/json";
import { parseConfig } from "@/core/node/registry";
import { getWsNode } from "./node-kit";
import type { WsEdge, WsNode, WsState } from "./types";

/** Bumped when the persisted document shape changes (migration anchor).
 *  v2: `syncGroups`/`groupFocus` → the `focus` coordination plane
 *  (`coordinationScopes`/`coordinationSpace`). */
export const DOC_VERSION = 2;

/** The on-disk/persisted document: a versioned wrapper around the graph state. */
export interface PersistedDoc {
  version: number;
  state: WsState;
}

/** Wrap the current live state as a versioned persisted document. */
export function toPersistedDoc(state: WsState): PersistedDoc {
  return { version: DOC_VERSION, state };
}

/** v1 carried these two fields where v2 carries the coordination plane. */
interface V1Fields {
  syncGroups?: Record<string, string>;
  groupFocus?: Record<string, string | null>;
}

/**
 * Upgrade an older persisted document to the current shape, in place, BEFORE
 * {@link validateDoc} runs (which rejects on version mismatch). A no-op for a
 * doc already at (or ahead of) {@link DOC_VERSION}.
 *
 * v1 → v2: `syncGroups` (node → group id, always the `focus` concern) and
 * `groupFocus` (group id → obs id) become the `focus` coordination type. The
 * literal group id becomes the scope NAME, so the same string hits the same
 * `scopeColor` hash — badges keep their exact color (R6: this path was
 * previously untested; a botched migration would drop a user's workspace).
 */
export function migrate(doc: PersistedDoc): PersistedDoc {
  if (doc.version >= DOC_VERSION) return doc;
  const state = doc.state as WsState & V1Fields;
  if (doc.version === 1) {
    const coordinationScopes: Record<string, Record<string, string>> = {};
    for (const [nodeId, gid] of Object.entries(state.syncGroups ?? {})) {
      coordinationScopes[nodeId] = { focus: gid };
    }
    const focusCells: Record<string, JsonValue> = {};
    for (const [gid, obsId] of Object.entries(state.groupFocus ?? {})) {
      focusCells[gid] = obsId ?? null;
    }
    state.coordinationScopes = coordinationScopes;
    state.coordinationSpace = Object.keys(focusCells).length > 0 ? { focus: focusCells } : {};
    delete state.syncGroups;
    delete state.groupFocus;
  }
  return { version: DOC_VERSION, state };
}

/**
 * Validate a persisted document before it re-enters the live graph — the
 * parse-on-load guarantee. Checks the doc version and every node's config
 * against its spec schema. A future load path calls this and refuses (or
 * migrates/repairs) on `ok: false` rather than applying corrupt state.
 */
export function validateDoc(doc: PersistedDoc): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (doc.version !== DOC_VERSION) {
    errors.push(`document version ${doc.version} != current ${DOC_VERSION} (migration needed)`);
  }
  for (const node of Object.values(doc.state.nodes)) {
    const spec = getWsNode(node.type);
    if (spec?.config && node.config !== undefined) {
      const res = parseConfig(spec, node.config);
      if (!res.ok) errors.push(`node "${node.id}" (${node.type}): ${res.error}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Drop nodes whose type is no longer registered (a node type removed since the
 * doc was saved) and any edges touching them, so removing a node type self-heals
 * a persisted graph instead of crashing at render on the dangling
 * `NODE_DEFS[type]` lookup. Also clears selection state pointing at a dropped
 * node/edge. Returns the doc unchanged when every node type resolves.
 */
export function dropUnknownNodes(doc: PersistedDoc): PersistedDoc {
  const s = doc.state;
  const dropped = Object.values(s.nodes).filter((n) => getWsNode(n.type) === undefined);
  if (dropped.length === 0) return doc;
  const ids = new Set(dropped.map((n) => n.id));
  console.warn(
    `[workspace] dropping ${ids.size} node(s) of unregistered type(s): ${[...new Set(dropped.map((n) => n.type))].join(", ")}`,
  );
  const nodes: Record<string, WsNode> = {};
  for (const [id, n] of Object.entries(s.nodes)) if (!ids.has(id)) nodes[id] = n;
  const edges: Record<string, WsEdge> = {};
  for (const [id, e] of Object.entries(s.edges)) if (!ids.has(e.from) && !ids.has(e.to)) edges[id] = e;
  return {
    ...doc,
    state: {
      ...s,
      nodes,
      edges,
      selection: s.selection && ids.has(s.selection) ? null : s.selection,
      selSet: s.selSet.filter((id) => !ids.has(id)),
      selectedEdge: s.selectedEdge && !edges[s.selectedEdge] ? null : s.selectedEdge,
    },
  };
}

/* ── storage backend (localStorage; swappable behind the seam) ────────── */

/** localStorage key prefix; the dataset session is appended for per-doc isolation. */
const STORAGE_PREFIX = "ndea.workspace";

/**
 * The localStorage key for a dataset session. `sessionKey` is a stable
 * dataset/table identity (see {@link import("./workspace-context")}); when none
 * is available we fall back to the bare prefix (single shared document).
 */
export function storageKey(sessionKey: string | null): string {
  return sessionKey ? `${STORAGE_PREFIX}:${sessionKey}` : STORAGE_PREFIX;
}

/** Serialize + write a document to localStorage. Swallows quota/denied errors
 *  (headless, private mode) — autosave is best-effort, never a hard failure. */
export function saveToStorage(key: string, state: WsState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(toPersistedDoc(state)));
  } catch {
    /* quota exceeded / storage denied — the doc just won't persist this tick */
  }
}

/** The outcome of a load attempt: a validated, ready-to-hydrate state, or a
 *  reason it was skipped (so the seam can `console.warn` + fall back to seed). */
export type LoadResult =
  | { kind: "ok"; state: WsState }
  | { kind: "miss" } // nothing stored
  | { kind: "invalid"; errors: string[] }; // present but corrupt / wrong version

/**
 * Read + parse + validate a saved document. Returns `ok` only after
 * {@link validateDoc} passes (parse-on-load); a missing key is a clean `miss`,
 * anything malformed (bad JSON, wrong shape, failed validation) is `invalid`
 * with the reasons — the load seam warns and seeds rather than applying it.
 */
export function loadFromStorage(key: string): LoadResult {
  let raw: string | null = null;
  try {
    if (typeof localStorage === "undefined") return { kind: "miss" };
    raw = localStorage.getItem(key);
  } catch {
    return { kind: "miss" }; // storage denied — treat as no saved doc
  }
  if (raw === null) return { kind: "miss" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", errors: ["stored document is not valid JSON"] };
  }
  if (!isPersistedDoc(parsed)) {
    return { kind: "invalid", errors: ["stored document has an unexpected shape"] };
  }
  // migrate older docs forward BEFORE validation (which rejects on version skew).
  const migrated = dropUnknownNodes(migrate(parsed));
  const res = validateDoc(migrated);
  return res.ok ? { kind: "ok", state: migrated.state } : { kind: "invalid", errors: res.errors };
}

/** Structural guard before {@link validateDoc} (which assumes the doc shape). */
function isPersistedDoc(v: unknown): v is PersistedDoc {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d.version !== "number") return false;
  const s = d.state;
  if (typeof s !== "object" || s === null) return false;
  const st = s as Record<string, unknown>;
  return typeof st.nodes === "object" && st.nodes !== null && typeof st.edges === "object" && st.edges !== null;
}
