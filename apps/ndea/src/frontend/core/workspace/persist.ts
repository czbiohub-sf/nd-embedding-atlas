import {
  exactNodeTypeRef,
  isSemanticVersion,
  migrateNodeConfig,
  type ExactNodeTypeRef,
  type JsonValue,
  type NodeConfigSnapshot,
} from "@ndea/sdk";
import { z } from "zod";

import { validateGraphRuntimeTopology } from "@/core/graph/runtime-session";
import type { AppNodeLibrary } from "@/core/node/library";
import { parseWorkspaceNodeAssetRecords } from "@/core/node-asset/schema";
import {
  createWorkspaceAppNodeLibrary,
  resolveWorkspaceNodeAssets,
  type WorkspaceAppNodeLibrary,
} from "@/core/node-asset/resolver";
import type { TreeNode } from "./stage/split-tree";
import type { WorkspaceDocumentState } from "./types";

export const DOC_VERSION = 6;

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const exactRefSchema = z
  .object({
    nodeTypeId: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[.-][a-z0-9]+)*)*$/),
    nodeTypeVersion: z.string().refine(isSemanticVersion, "node type version must be semantic"),
  })
  .strict();
const configSnapshotSchema = z
  .object({
    version: z.number().int().nonnegative().refine(Number.isSafeInteger, "config version must be safe"),
    value: jsonValueSchema,
  })
  .strict();
const nodeIdSchema = z
  .string()
  .min(1)
  .refine((id) => !id.includes("::asset::"), {
    message: 'node id uses reserved runtime namespace "::asset::"',
  });
const nodeSchema = z
  .object({
    id: nodeIdSchema,
    definitionRef: exactRefSchema,
    label: z.string(),
    parent: z.string().nullable().optional(),
    stamp: z.number().optional(),
    config: configSnapshotSchema.optional(),
  })
  .strict();
const edgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    fromPort: z.string().min(1),
    to: z.string().min(1),
    toPort: z.string().min(1),
    kind: z.enum(["pred", "sel", "focus"]),
  })
  .strict();
const positionSchema = z.object({ x: z.number(), y: z.number() }).strict();
const sizeSchema = z.object({ w: z.number(), h: z.number() }).strict();
const sizeOverrideSchema = z.object({ card: sizeSchema.optional(), full: sizeSchema.optional() }).strict();
const flagSchema = z.object({ bypass: z.boolean().optional(), off: z.boolean().optional() }).strict();
const treeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.union([
    z.string(),
    z
      .object({
        dir: z.enum(["row", "col"]),
        ratio: z.number().min(0).max(1),
        a: treeSchema,
        b: treeSchema,
      })
      .strict(),
  ]),
);
const coordinationSpaceSchema = z.record(z.string(), z.record(z.string(), jsonValueSchema));
const persistedStateSchema = z
  .object({
    nodeAssets: z.array(z.unknown()),
    nodes: z.record(z.string(), nodeSchema),
    edges: z.record(z.string(), edgeSchema),
    positions: z.record(z.string(), positionSchema),
    sizeOverrides: z.record(z.string(), sizeOverrideSchema),
    formOverride: z.record(z.string(), z.enum(["chip", "card", "full"])),
    formLocked: z.record(z.string(), z.boolean()),
    selectedNodeId: z.string().nullable(),
    selectedNodeIds: z.array(z.string()),
    selectedEdgeId: z.string().nullable(),
    explicit: z.record(z.string(), z.enum(["embedded", "staged"])),
    stageTree: treeSchema.nullable(),
    disposition: z.enum(["strip", "full", "hidden"]),
    stripH: z.number(),
    claimed: z.string().nullable(),
    graphPath: z.string().nullable(),
    flags: z.record(z.string(), flagSchema),
    coordinationScopes: z.record(z.string(), z.record(z.string(), z.string())),
    coordinationSpace: coordinationSpaceSchema,
  })
  .strict()
  .superRefine((state, context) => {
    try {
      parseWorkspaceNodeAssetRecords(state.nodeAssets);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["nodeAssets"],
        message: errorMessage(error),
      });
    }
    for (const [key, node] of Object.entries(state.nodes)) {
      if (key !== node.id) {
        context.addIssue({ code: "custom", path: ["nodes", key, "id"], message: "node key and id must match" });
      }
    }
    for (const [key, edge] of Object.entries(state.edges)) {
      if (key !== edge.id) {
        context.addIssue({ code: "custom", path: ["edges", key, "id"], message: "edge key and id must match" });
      }
    }
    const focus = state.coordinationSpace.focus;
    if (!focus) return;
    for (const [scope, value] of Object.entries(focus)) {
      if (value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) continue;
      context.addIssue({
        code: "custom",
        path: ["coordinationSpace", "focus", scope],
        message: "focus row index must be a non-negative integer or null",
      });
    }
  });
const persistedDocSchema = z.object({ version: z.literal(DOC_VERSION), state: persistedStateSchema }).strict();

export interface PersistedDoc {
  version: 6;
  state: WorkspaceDocumentState;
}

export interface WorkspaceStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export function browserWorkspaceStorage(): WorkspaceStorage {
  return {
    read(key) {
      if (typeof localStorage === "undefined") throw new Error("workspace storage is unavailable");
      return localStorage.getItem(key);
    },
    write(key, value) {
      if (typeof localStorage === "undefined") throw new Error("workspace storage is unavailable");
      localStorage.setItem(key, value);
    },
  };
}

export function toPersistedDoc(state: WorkspaceDocumentState): PersistedDoc {
  const persisted = {
    version: DOC_VERSION,
    state: {
      nodes: state.nodes,
      nodeAssets: state.nodeAssets,
      edges: state.edges,
      positions: state.positions,
      sizeOverrides: state.sizeOverrides,
      formOverride: state.formOverride,
      formLocked: state.formLocked,
      selectedNodeId: state.selectedNodeId,
      selectedNodeIds: state.selectedNodeIds,
      selectedEdgeId: state.selectedEdgeId,
      explicit: state.explicit,
      stageTree: state.stageTree,
      disposition: state.disposition,
      stripH: state.stripH,
      claimed: state.claimed,
      graphPath: state.graphPath,
      flags: state.flags,
      coordinationScopes: state.coordinationScopes,
      coordinationSpace: state.coordinationSpace,
    },
  };
  return persistedDocSchema.parse(persisted) as unknown as PersistedDoc;
}

type LegacyDocument = { version: number; state: Record<string, unknown> };

const LEGACY_NODE_REFS: Readonly<Record<string, ExactNodeTypeRef>> = Object.freeze({
  obs: exactNodeTypeRef("obs", "1.0.0"),
  dataset: exactNodeTypeRef("dataset", "1.0.0"),
  selection: exactNodeTypeRef("cache", "1.0.0"),
  fov: exactNodeTypeRef("image-viewer", "1.0.0"),
  threshold: exactNodeTypeRef("transform-filter", "1.0.0"),
  "transform-filter": exactNodeTypeRef("transform-filter", "1.0.0"),
  wrangle: exactNodeTypeRef("wrangle", "1.0.0"),
  annotate: exactNodeTypeRef("annotate", "1.0.0"),
  count: exactNodeTypeRef("count", "1.0.0"),
  table: exactNodeTypeRef("table", "1.0.0"),
  scatter: exactNodeTypeRef("scatter", "1.0.0"),
  "count-plot": exactNodeTypeRef("count-plot", "1.0.0"),
  histogram: exactNodeTypeRef("histogram", "1.0.0"),
  gallery: exactNodeTypeRef("gallery", "1.0.0"),
  "image-viewer": exactNodeTypeRef("image-viewer", "1.0.0"),
  cache: exactNodeTypeRef("cache", "1.0.0"),
  subnet: exactNodeTypeRef("subnet", "1.0.0"),
  proxy: exactNodeTypeRef("proxy", "1.0.0"),
});
const RETIRED_INPUT_PORTS: Record<string, string> = {
  "image-viewer@1.0.0:in": "focus-in",
  "image-viewer@1.0.0:highlight-in": "focus-in",
};

type LegacyConfigAdapter = (value: Record<string, JsonValue>, defaults: JsonValue) => JsonValue;
const LEGACY_CONFIG_ADAPTERS: Record<string, LegacyConfigAdapter> = {
  "annotate@1.0.0": mergeLegacyConfig,
  "count-plot@1.0.0": mergeLegacyConfig,
  "histogram@1.0.0": mergeLegacyConfig,
  "dataset@1.0.0": (value, defaults) => ({
    ...(defaults as Record<string, JsonValue>),
    datasetKey: value.datasetKey ?? value.dataset ?? null,
  }),
  "gallery@1.0.0": mergeLegacyConfig,
  "image-viewer@1.0.0": (value, defaults) => ({
    ...(defaults as Record<string, JsonValue>),
    ...value,
    datasetKey: value.datasetKey ?? value.fov ?? null,
  }),
  "scatter@1.0.0": mergeLegacyConfig,
  "table@1.0.0": mergeLegacyConfig,
  "transform-filter@1.0.0": mergeLegacyConfig,
  "wrangle@1.0.0": mergeLegacyConfig,
};

export function migrate(doc: unknown, nodeLibrary: AppNodeLibrary): PersistedDoc {
  const legacy = parseVersionedDocument(doc);
  if (legacy.version > DOC_VERSION || legacy.version < 1) {
    throw new Error(`unsupported workspace document version ${legacy.version}`);
  }
  let step = structuredClone(legacy);
  if (step.version === 1) step = migrateV1ToV2(step);
  if (step.version === 2) step = migrateV2ToV3(step, nodeLibrary);
  if (step.version === 3) step = migrateV3ToV4(step, nodeLibrary);
  if (step.version === 4) step = migrateV4ToV5(step);
  if (step.version === 5) step = migrateV5ToV6(step);
  return persistedDocSchema.parse(step) as unknown as PersistedDoc;
}

function migrateV1ToV2(doc: LegacyDocument): LegacyDocument {
  const state = { ...doc.state };
  const syncGroups = objectRecord(state.syncGroups);
  const groupFocus = objectRecord(state.groupFocus);
  const coordinationScopes: Record<string, Record<string, string>> = {};
  for (const [nodeId, scope] of Object.entries(syncGroups)) {
    if (typeof scope === "string") coordinationScopes[nodeId] = { focus: scope };
  }
  const focus: Record<string, JsonValue> = {};
  for (const [scope, value] of Object.entries(groupFocus)) {
    if (typeof value === "string" || value === null) focus[scope] = value;
  }
  delete state.syncGroups;
  delete state.groupFocus;
  state.coordinationScopes = coordinationScopes;
  state.coordinationSpace = Object.keys(focus).length > 0 ? { focus } : {};
  return { version: 2, state };
}

function migrateV2ToV3(doc: LegacyDocument, nodeLibrary: AppNodeLibrary): LegacyDocument {
  const state = structuredClone(doc.state);
  const legacyNodes = objectRecord(state.nodes);
  const nodes: Record<string, unknown> = {};
  const refsById: Record<string, ExactNodeTypeRef> = {};
  const seenIds = new Set<string>();
  for (const [key, rawNode] of Object.entries(legacyNodes)) {
    const node = objectRecord(rawNode);
    const id = stringField(node, "id");
    if (id !== key || seenIds.has(id)) throw new Error(`v2 node id collision at "${key}"`);
    seenIds.add(id);
    const legacyType = stringField(node, "type");
    const ref = LEGACY_NODE_REFS[legacyType];
    if (!ref) throw new Error(`v2 node type "${legacyType}" has no exact migration target`);
    if (!nodeLibrary.getSpecExact(ref)) {
      throw new Error(`v2 node type "${legacyType}" exact migration target ${refKey(ref)} is unavailable`);
    }
    refsById[id] = ref;
    const migrated: Record<string, unknown> = {
      id,
      definitionRef: ref,
      label: stringField(node, "label"),
    };
    if (node.parent !== undefined) migrated.parent = node.parent;
    if (node.stamp !== undefined) migrated.stamp = node.stamp;
    if (node.config !== undefined) migrated.config = normalizeLegacyConfig(ref, node.config, nodeLibrary);
    nodes[key] = migrated;
  }
  const edges = objectRecord(state.edges);
  const seenEdgeIds = new Set<string>();
  state.edges = Object.fromEntries(
    Object.entries(edges).map(([key, rawEdge]) => {
      const edge = { ...objectRecord(rawEdge) };
      const id = stringField(edge, "id");
      if (id !== key || seenEdgeIds.has(id)) throw new Error(`v2 edge id collision at "${key}"`);
      seenEdgeIds.add(id);
      if (typeof edge.toPort === "string" && typeof edge.to === "string") {
        const targetRef = refsById[edge.to];
        const legacyPortKey = targetRef ? `${refKey(targetRef)}:${edge.toPort}` : "";
        edge.toPort = RETIRED_INPUT_PORTS[legacyPortKey] ?? edge.toPort;
      }
      return [key, edge];
    }),
  );
  state.nodes = nodes;
  state.selectedNodeId = state.selection ?? null;
  state.selectedNodeIds = state.selSet ?? [];
  state.selectedEdgeId = state.selectedEdge ?? null;
  delete state.selection;
  delete state.selSet;
  delete state.selectedEdge;
  state.coordinationSpace = numericFocusSpace(objectRecord(state.coordinationSpace));
  return { version: 3, state };
}

function migrateV3ToV4(doc: LegacyDocument, nodeLibrary: AppNodeLibrary): LegacyDocument {
  const state = structuredClone(doc.state);
  const nodes = objectRecord(state.nodes);
  const edges = objectRecord(state.edges);
  state.edges = Object.fromEntries(
    Object.entries(edges).map(([key, rawEdge]) => {
      const edge = { ...objectRecord(rawEdge) };
      const source = objectRecord(nodes[stringField(edge, "from")]);
      const rawRef = exactRefSchema.parse(source.definitionRef);
      const ref = exactNodeTypeRef(rawRef.nodeTypeId, rawRef.nodeTypeVersion);
      const spec = nodeLibrary.getSpecExact(ref);
      const output = spec?.definition.outputs.find((port) => port.kind === edge.kind) ?? spec?.definition.outputs[0];
      edge.fromPort = output?.id ?? "out";
      return [key, edge];
    }),
  );
  state.nodeAssets = [];
  return { version: 4, state };
}

function migrateV4ToV5(doc: LegacyDocument): LegacyDocument {
  return migrateRetiredInputPorts(doc, 5);
}

function migrateV5ToV6(doc: LegacyDocument): LegacyDocument {
  return migrateRetiredInputPorts(doc, 6);
}

function migrateRetiredInputPorts(doc: LegacyDocument, version: number): LegacyDocument {
  const state = structuredClone(doc.state);
  const nodes = objectRecord(state.nodes);
  const edges = objectRecord(state.edges);
  state.edges = Object.fromEntries(
    Object.entries(edges).map(([key, rawEdge]) => {
      const edge = { ...objectRecord(rawEdge) };
      if (typeof edge.to !== "string" || typeof edge.toPort !== "string") return [key, edge];
      const target = nodes[edge.to];
      if (!isPlainObject(target)) return [key, edge];
      const parsedRef = exactRefSchema.safeParse(target.definitionRef);
      if (!parsedRef.success) return [key, edge];
      const ref = exactNodeTypeRef(parsedRef.data.nodeTypeId, parsedRef.data.nodeTypeVersion);
      edge.toPort = RETIRED_INPUT_PORTS[`${refKey(ref)}:${edge.toPort}`] ?? edge.toPort;
      return [key, edge];
    }),
  );
  return { version, state };
}

function normalizeLegacyConfig(ref: ExactNodeTypeRef, raw: unknown, nodeLibrary: AppNodeLibrary): NodeConfigSnapshot {
  const spec = nodeLibrary.getSpecExact(ref);
  const contract = spec?.definition.config;
  if (!spec || !contract) throw new Error(`v2 config target ${refKey(ref)} is unavailable`);
  const value = objectRecord(raw) as Record<string, JsonValue>;
  const defaults = structuredClone(contract.defaultValue) as JsonValue;
  const adapter = LEGACY_CONFIG_ADAPTERS[refKey(ref)];
  if (!adapter) throw new Error(`v2 config target ${refKey(ref)} has no legacy version 0 adapter`);
  const normalized = adapter(value, defaults);
  const parsed = contract.schema.parse(normalized);
  return configSnapshotSchema.parse({ version: contract.version, value: parsed }) as NodeConfigSnapshot;
}

function mergeLegacyConfig(value: Record<string, JsonValue>, defaults: JsonValue): JsonValue {
  return isPlainObject(defaults) ? { ...defaults, ...value } : value;
}

export function validateDoc(doc: unknown, nodeLibrary: AppNodeLibrary): { ok: boolean; errors: string[] } {
  try {
    const parsed = persistedDocSchema.parse(doc) as unknown as PersistedDoc;
    const prepared = prepareWorkspaceAssetLibrary(nodeLibrary, parsed.state);
    decodeCurrentConfigs({ ...parsed.state, nodeAssets: prepared.records }, prepared.library);
    return { ok: true, errors: [] };
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
}

export function fromPersistedDoc(
  doc: unknown,
  nodeLibrary: AppNodeLibrary,
): { ok: true; state: WorkspaceDocumentState } | { ok: false; errors: string[] } {
  try {
    const parsed = persistedDocSchema.parse(doc) as unknown as PersistedDoc;
    const prepared = prepareWorkspaceAssetLibrary(nodeLibrary, parsed.state);
    const state = decodeCurrentConfigs({ ...parsed.state, nodeAssets: prepared.records }, prepared.library);
    return { ok: true, state };
  } catch (error) {
    return { ok: false, errors: [errorMessage(error)] };
  }
}

function prepareWorkspaceAssetLibrary(
  nodeLibrary: AppNodeLibrary,
  state: WorkspaceDocumentState,
): {
  readonly library: AppNodeLibrary;
  readonly records: WorkspaceDocumentState["nodeAssets"];
} {
  const records = parseWorkspaceNodeAssetRecords(state.nodeAssets);
  if (!isWorkspaceAppNodeLibrary(nodeLibrary)) return { library: nodeLibrary, records };
  const resolution = resolveWorkspaceNodeAssets(nodeLibrary.baseLibrary(), nodeLibrary.assetSnapshot().assets, records);
  return {
    library: createWorkspaceAppNodeLibrary(nodeLibrary.baseLibrary(), resolution.snapshot),
    records: resolution.records,
  };
}

function isWorkspaceAppNodeLibrary(nodeLibrary: AppNodeLibrary): nodeLibrary is WorkspaceAppNodeLibrary {
  return (
    "assetSnapshot" in nodeLibrary &&
    typeof nodeLibrary.assetSnapshot === "function" &&
    "replaceAssetSnapshot" in nodeLibrary &&
    typeof nodeLibrary.replaceAssetSnapshot === "function" &&
    "baseLibrary" in nodeLibrary &&
    typeof nodeLibrary.baseLibrary === "function"
  );
}

function decodeCurrentConfigs(state: WorkspaceDocumentState, nodeLibrary: AppNodeLibrary): WorkspaceDocumentState {
  const nodes: WorkspaceDocumentState["nodes"] = {};
  for (const [key, node] of Object.entries(state.nodes)) {
    const spec = nodeLibrary.getSpecExact(node.definitionRef);
    const contract = spec?.definition.config;
    if (!spec || node.config === undefined) {
      nodes[key] = node;
      continue;
    }
    if (!contract) throw new Error(`node "${node.id}" does not accept configuration`);
    const migrated = migrateNodeConfig(contract, node.config);
    const config = configSnapshotSchema.parse({
      version: migrated.version,
      value: migrated.value,
    }) as NodeConfigSnapshot;
    nodes[key] = { ...node, config };
  }
  return { ...state, nodes };
}

const STORAGE_PREFIX = "ndea.workspace";

export function storageKey(sessionKey: string | null): string {
  return sessionKey ? `${STORAGE_PREFIX}:${sessionKey}` : STORAGE_PREFIX;
}

export function saveToStorage(storage: WorkspaceStorage, key: string, state: WorkspaceDocumentState): void {
  storage.write(key, JSON.stringify(toPersistedDoc(state)));
}

export class WorkspaceAutosave {
  private stopped = false;
  private readonly storage: WorkspaceStorage;
  private readonly key: string;
  private readonly onFailure: (error: unknown) => void;

  constructor(storage: WorkspaceStorage, key: string, onFailure: (error: unknown) => void) {
    this.storage = storage;
    this.key = key;
    this.onFailure = onFailure;
  }

  save(state: WorkspaceDocumentState): boolean {
    if (this.stopped) return false;
    try {
      saveToStorage(this.storage, this.key, state);
      return true;
    } catch (error) {
      this.stopped = true;
      this.onFailure(error);
      return false;
    }
  }
}

export type RecoveryStage =
  | "read"
  | "parse"
  | "version"
  | "migration"
  | "config"
  | "topology"
  | "backup-write"
  | "backup-verify"
  | "rewrite"
  | "autosave";

export type LoadResult =
  | { kind: "ok"; state: WorkspaceDocumentState }
  | { kind: "miss" }
  | {
      kind: "recovery";
      stage: RecoveryStage;
      errors: string[];
      raw: string | null;
      state?: WorkspaceDocumentState;
      backupKey?: string;
    };

export function loadFromStorage(storage: WorkspaceStorage, key: string, nodeLibrary: AppNodeLibrary): LoadResult {
  let raw: string | null;
  try {
    raw = storage.read(key);
  } catch (error) {
    return recovery("read", error, null);
  }
  if (raw === null) return { kind: "miss" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return recovery("parse", error, raw);
  }

  let sourceVersion: number;
  try {
    sourceVersion = parseVersionedDocument(parsed).version;
    if (sourceVersion > DOC_VERSION || sourceVersion < 1)
      throw new Error(`unsupported workspace document version ${sourceVersion}`);
  } catch (error) {
    return recovery("version", error, raw);
  }

  let migrated: PersistedDoc;
  try {
    migrated = migrate(parsed, nodeLibrary);
  } catch (error) {
    return recovery(sourceVersion === DOC_VERSION ? "parse" : "migration", error, raw);
  }

  const decoded = fromPersistedDoc(migrated, nodeLibrary);
  if (!decoded.ok) return recovery("config", decoded.errors.join("; "), raw);
  try {
    validateGraphRuntimeTopology(decoded.state, prepareWorkspaceAssetLibrary(nodeLibrary, decoded.state).library);
  } catch (error) {
    return recovery("topology", error, raw, decoded.state);
  }

  let canonical: string;
  try {
    canonical = JSON.stringify(toPersistedDoc(decoded.state));
  } catch (error) {
    return recovery("config", error, raw, decoded.state);
  }
  if (sourceVersion === DOC_VERSION && canonical === raw) return { kind: "ok", state: decoded.state };

  const backupKey = `${key}.backup.v${sourceVersion}`;
  try {
    storage.write(backupKey, raw);
  } catch (error) {
    return recovery("backup-write", error, raw, decoded.state, backupKey);
  }
  try {
    if (storage.read(backupKey) !== raw) throw new Error(`workspace backup verification failed for "${backupKey}"`);
  } catch (error) {
    return recovery("backup-verify", error, raw, decoded.state, backupKey);
  }
  try {
    storage.write(key, canonical);
  } catch (error) {
    return recovery("rewrite", error, raw, decoded.state, backupKey);
  }
  return { kind: "ok", state: decoded.state };
}

function recovery(
  stage: RecoveryStage,
  error: unknown,
  raw: string | null,
  state?: WorkspaceDocumentState,
  backupKey?: string,
): LoadResult {
  return {
    kind: "recovery",
    stage,
    errors: [errorMessage(error)],
    raw,
    ...(state ? { state } : {}),
    ...(backupKey ? { backupKey } : {}),
  };
}

function parseVersionedDocument(value: unknown): LegacyDocument {
  const document = objectRecord(value);
  if (!Number.isSafeInteger(document.version)) throw new Error("workspace document version is missing or invalid");
  return { version: document.version as number, state: objectRecord(document.state) };
}

function numericFocusSpace(space: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(space);
  if (result.focus === undefined) return result;
  const focus = objectRecord(result.focus);
  if (Object.keys(focus).length === 0) return result;
  result.focus = Object.fromEntries(
    Object.entries(focus).map(([scope, value]) => {
      if (value === null) return [scope, null];
      const numeric =
        typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`focus cell "${scope}" is not a row index`);
      return [scope, numeric];
    }),
  );
  return result;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error("workspace document has an unexpected shape");
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`workspace field "${key}" must be a string`);
  return value;
}

function refKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
