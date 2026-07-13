import { rowIndex, type JsonValue, type RowIndex } from "@ndea/sdk";
import { parseWorkspaceNodeConfig, type WorkspaceNodeLibrary } from "./node-projection";
import type { WorkspaceCoordinationSpace, WorkspaceDocumentState } from "./types";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";

/** v2 replaces `syncGroups` and `groupFocus` with the coordination plane. */
export const DOC_VERSION = 2;

export type PersistedWorkspaceDocumentStateV2 = Omit<
  WorkspaceDocumentState,
  "selectedNodeId" | "selectedNodeIds" | "selectedEdgeId" | "coordinationSpace"
> & {
  /** Legacy v2 key retained until the document-format migration. */
  selection: string | null;
  /** Legacy v2 key retained until the document-format migration. */
  selSet: string[];
  /** Legacy v2 key retained until the document-format migration. */
  selectedEdge: string | null;
  /** Legacy v2 stores focus row indices as strings. Other cell values are unchanged. */
  coordinationSpace: Record<string, Record<string, JsonValue>>;
};

export interface PersistedDoc {
  version: number;
  state: PersistedWorkspaceDocumentStateV2;
}

export function toPersistedDoc(state: WorkspaceDocumentState): PersistedDoc {
  const coordinationSpace: Record<string, Record<string, JsonValue>> = {};
  for (const [type, cells] of Object.entries(state.coordinationSpace)) {
    if (!cells) continue;
    if (type !== "focus") {
      coordinationSpace[type] = cells;
      continue;
    }
    const focusCells = cells as Record<string, RowIndex | null>;
    coordinationSpace.focus = Object.fromEntries(
      Object.entries(focusCells).map(([scope, value]) => [scope, value === null ? null : String(value)]),
    );
  }
  return {
    version: DOC_VERSION,
    state: {
      nodes: state.nodes,
      edges: state.edges,
      positions: state.positions,
      sizeOverrides: state.sizeOverrides,
      formOverride: state.formOverride,
      formLocked: state.formLocked,
      selection: state.selectedNodeId,
      selSet: state.selectedNodeIds,
      selectedEdge: state.selectedEdgeId,
      explicit: state.explicit,
      stageTree: state.stageTree,
      disposition: state.disposition,
      stripH: state.stripH,
      claimed: state.claimed,
      graphPath: state.graphPath,
      flags: state.flags,
      coordinationScopes: state.coordinationScopes,
      coordinationSpace,
    },
  };
}

interface V1Fields {
  syncGroups?: Record<string, string>;
  groupFocus?: Record<string, string | null>;
}

/** Migrates older documents before validation. */
export function migrate(doc: PersistedDoc): PersistedDoc {
  if (doc.version >= DOC_VERSION) return doc;
  const state = doc.state as PersistedWorkspaceDocumentStateV2 & V1Fields;
  if (doc.version === 1) {
    const coordinationScopes: Record<string, Record<string, string>> = {};
    for (const [nodeId, gid] of Object.entries(state.syncGroups ?? {})) {
      coordinationScopes[nodeId] = { focus: gid };
    }
    const focusCells: Record<string, JsonValue> = {};
    for (const [gid, serializedFocus] of Object.entries(state.groupFocus ?? {})) {
      focusCells[gid] = serializedFocus ?? null;
    }
    state.coordinationScopes = coordinationScopes;
    state.coordinationSpace = Object.keys(focusCells).length > 0 ? { focus: focusCells } : {};
    delete state.syncGroups;
    delete state.groupFocus;
  }
  return { version: DOC_VERSION, state };
}

/** Checks the document version and every node configuration. */
export function validateDoc(doc: PersistedDoc, nodeLibrary: WorkspaceNodeLibrary): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (doc.version !== DOC_VERSION) {
    errors.push(`document version ${doc.version} != current ${DOC_VERSION} (migration needed)`);
  }
  for (const node of Object.values(doc.state.nodes)) {
    const spec = nodeLibrary.getSpec(node.type);
    if (spec?.definition.config && node.config !== undefined) {
      const res = parseWorkspaceNodeConfig(spec, node.config);
      if (!res.ok) errors.push(`node "${node.id}" (${node.type}): ${res.error}`);
    }
  }
  const coordinationSpace = (doc.state as { coordinationSpace?: unknown }).coordinationSpace;
  if (coordinationSpace === undefined) {
    if (doc.version === DOC_VERSION) errors.push("document coordinationSpace has an unexpected shape");
  } else if (typeof coordinationSpace !== "object" || coordinationSpace === null) {
    errors.push("document coordinationSpace has an unexpected shape");
  } else {
    errors.push(...decodeFocusCells((coordinationSpace as { focus?: Record<string, JsonValue> }).focus).errors);
  }
  return { ok: errors.length === 0, errors };
}

/** Convert the serialized v2 compatibility shape into canonical runtime state. */
export function fromPersistedDoc(
  doc: PersistedDoc,
): { ok: true; state: WorkspaceDocumentState } | { ok: false; errors: string[] } {
  const focus = decodeFocusCells(doc.state.coordinationSpace.focus);
  if (focus.errors.length > 0) return { ok: false, errors: focus.errors };
  const s = doc.state;
  const coordinationSpace: WorkspaceCoordinationSpace = { ...s.coordinationSpace };
  if (focus.cells) coordinationSpace.focus = focus.cells;
  else delete coordinationSpace.focus;
  return {
    ok: true,
    state: {
      nodes: s.nodes,
      edges: s.edges,
      positions: s.positions,
      sizeOverrides: s.sizeOverrides,
      formOverride: s.formOverride,
      formLocked: s.formLocked,
      selectedNodeId: s.selection,
      selectedNodeIds: s.selSet,
      selectedEdgeId: s.selectedEdge,
      explicit: s.explicit,
      stageTree: s.stageTree,
      disposition: s.disposition,
      stripH: s.stripH,
      claimed: s.claimed,
      graphPath: s.graphPath,
      flags: s.flags,
      coordinationScopes: s.coordinationScopes,
      coordinationSpace,
    },
  };
}

function decodeFocusCells(cells: Record<string, JsonValue> | undefined): {
  cells?: NonNullable<WorkspaceCoordinationSpace["focus"]>;
  errors: string[];
} {
  if (!cells) return { errors: [] };
  const decoded: NonNullable<WorkspaceCoordinationSpace["focus"]> = {};
  const errors: string[] = [];
  for (const [scope, value] of Object.entries(cells)) {
    if (value === null) {
      decoded[scope] = null;
      continue;
    }
    const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push(`coordinationSpace.focus.${scope} must be a non-negative integer string or null`);
      continue;
    }
    decoded[scope] = rowIndex(parsed);
  }
  return { cells: decoded, errors };
}

/**
 * Drop nodes whose type is no longer registered (a node type removed since the
 * doc was saved) and any edges touching them, so removing a node type self-heals
 * a persisted graph instead of crashing at render on a missing descriptor.
 * Also clears editor selection state pointing at a dropped
 * node/edge. Returns the doc unchanged when every node type resolves.
 */
export function dropUnknownNodes(doc: PersistedDoc, nodeLibrary: WorkspaceNodeLibrary): PersistedDoc {
  const s = doc.state;
  const dropped = Object.values(s.nodes).filter((n) => nodeLibrary.getSpec(n.type) === undefined);
  if (dropped.length === 0) return doc;
  const ids = new Set(dropped.map((n) => n.id));
  console.warn(
    `[workspace] dropping ${ids.size} node(s) of unregistered type(s): ${[...new Set(dropped.map((n) => n.type))].join(", ")}`,
  );
  const nodes: Record<string, GraphDocumentNode> = {};
  for (const [id, n] of Object.entries(s.nodes)) if (!ids.has(id)) nodes[id] = n;
  const edges: Record<string, GraphDocumentEdge> = {};
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

const STORAGE_PREFIX = "ndea.workspace";

export function storageKey(sessionKey: string | null): string {
  return sessionKey ? `${STORAGE_PREFIX}:${sessionKey}` : STORAGE_PREFIX;
}

/** Serialize + write a document to localStorage. Swallows quota/denied errors
 *  (headless, private mode) — autosave is best-effort, never a hard failure. */
export function saveToStorage(key: string, state: WorkspaceDocumentState): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(toPersistedDoc(state)));
  } catch {
    /* quota exceeded / storage denied — the doc just won't persist this tick */
  }
}

export type LoadResult =
  | { kind: "ok"; state: WorkspaceDocumentState }
  | { kind: "miss" } // nothing stored
  | { kind: "invalid"; errors: string[] }; // present but corrupt / wrong version

export function loadFromStorage(key: string, nodeLibrary: WorkspaceNodeLibrary): LoadResult {
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
  const migrated = dropUnknownNodes(migrate(parsed), nodeLibrary);
  const res = validateDoc(migrated, nodeLibrary);
  if (!res.ok) return { kind: "invalid", errors: res.errors };
  const decoded = fromPersistedDoc(migrated);
  return decoded.ok ? { kind: "ok", state: decoded.state } : { kind: "invalid", errors: decoded.errors };
}

function isPersistedDoc(v: unknown): v is PersistedDoc {
  if (typeof v !== "object" || v === null) return false;
  const d = v as Record<string, unknown>;
  if (typeof d.version !== "number") return false;
  const s = d.state;
  if (typeof s !== "object" || s === null) return false;
  const st = s as Record<string, unknown>;
  return typeof st.nodes === "object" && st.nodes !== null && typeof st.edges === "object" && st.edges !== null;
}
