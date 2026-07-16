import { compareSemanticVersions, exactNodeTypeRef, type ExactNodeTypeRef } from "@ndea/sdk";
import { z } from "zod";

import {
  assetNodeTypeId,
  exactNodeAssetRefKey,
  exactNodeRefKey,
  nodeAssetId,
  nodeAssetVersion,
  parseNodeAssetDefinition,
  type ExactNodeAssetRef,
  type NodeAssetDefinition,
} from "./schema";

export type NodeAssetSourceKind = "project" | "user" | "embedded";

export interface NodeAssetSource {
  readonly sourceId: string;
  readonly kind: NodeAssetSourceKind;
  readonly assets: readonly NodeAssetDefinition[];
  readonly current?: Readonly<Record<string, string>>;
  readonly readOnly?: boolean;
  readonly inPalette?: boolean;
}

export interface NodeAssetLibraryEntry {
  readonly definition: NodeAssetDefinition;
  readonly source: Pick<NodeAssetSource, "sourceId" | "kind" | "readOnly" | "inPalette">;
}

export interface NodeAssetLibrary {
  getExact(ref: ExactNodeAssetRef | ExactNodeTypeRef): NodeAssetLibraryEntry | undefined;
  getCurrent(assetId: string): NodeAssetLibraryEntry | undefined;
  entries(): readonly NodeAssetLibraryEntry[];
  paletteEntries(): readonly NodeAssetLibraryEntry[];
  sources(): readonly NodeAssetSource[];
}

export interface NodeAssetJsonStorage {
  read(): string | null;
  replaceAtomically(canonicalJson: string): void;
}

export function browserNodeAssetJsonStorage(key = "ndea.node-assets.user"): NodeAssetJsonStorage {
  return {
    read() {
      if (typeof localStorage === "undefined") throw new Error("user node asset storage is unavailable");
      return localStorage.getItem(key);
    },
    replaceAtomically(canonicalJson) {
      if (typeof localStorage === "undefined") throw new Error("user node asset storage is unavailable");
      localStorage.setItem(key, canonicalJson);
    },
  };
}

export type UserNodeAssetLoadResult =
  | { readonly kind: "ok"; readonly source: NodeAssetSource }
  | { readonly kind: "miss"; readonly source: NodeAssetSource }
  | {
      readonly kind: "recovery";
      readonly error: string;
      readonly raw: string | null;
      readonly source: NodeAssetSource;
    };

export function createNodeAssetLibrary(sources: readonly NodeAssetSource[]): NodeAssetLibrary {
  const frozenSources = Object.freeze(sources.map(parseSource));
  const entries: NodeAssetLibraryEntry[] = [];
  const byAssetRef = new Map<string, NodeAssetLibraryEntry>();
  const byNodeRef = new Map<string, NodeAssetLibraryEntry>();
  const currentByAssetId = new Map<string, NodeAssetLibraryEntry>();
  const declaredCurrent = new Set<string>();

  for (const source of frozenSources) {
    for (const definition of source.assets) {
      const assetKey = exactNodeAssetRefKey(definition);
      const nodeKey = exactNodeRefKey(definition.nodeTypeRef);
      const collision = byAssetRef.get(assetKey) ?? byNodeRef.get(nodeKey);
      if (collision) {
        throw new Error(
          `node asset collision "${assetKey}" between "${collision.source.sourceId}" and "${source.sourceId}"`,
        );
      }
      const entry = deepFreeze({
        definition,
        source: {
          sourceId: source.sourceId,
          kind: source.kind,
          ...(source.readOnly === undefined ? {} : { readOnly: source.readOnly }),
          ...(source.inPalette === undefined ? {} : { inPalette: source.inPalette }),
        },
      });
      entries.push(entry);
      byAssetRef.set(assetKey, entry);
      byNodeRef.set(nodeKey, entry);
    }
  }

  validateDependencies(byAssetRef);
  validateDependencyCycles(byAssetRef);

  for (const source of frozenSources) {
    for (const [assetId, selectedVersion] of Object.entries(source.current ?? {})) {
      const selected = byAssetRef.get(`${assetId}@${selectedVersion}`);
      if (!selected || selected.source.sourceId !== source.sourceId) {
        throw new Error(
          `source "${source.sourceId}" declares unavailable current asset "${assetId}@${selectedVersion}"`,
        );
      }
      const previous = currentByAssetId.get(assetId);
      if (
        !previous ||
        compareSemanticVersions(selected.definition.assetVersion, previous.definition.assetVersion) > 0
      ) {
        currentByAssetId.set(assetId, selected);
      }
      declaredCurrent.add(assetId);
    }
  }
  for (const entry of entries) {
    if (declaredCurrent.has(entry.definition.assetId)) continue;
    const previous = currentByAssetId.get(entry.definition.assetId);
    if (!previous || compareSemanticVersions(entry.definition.assetVersion, previous.definition.assetVersion) > 0) {
      currentByAssetId.set(entry.definition.assetId, entry);
    }
  }

  const frozenEntries = Object.freeze(entries);
  const palette = Object.freeze(
    [...currentByAssetId.values()].filter(
      (entry) => entry.definition.visibility === "public" && entry.source.inPalette !== false,
    ),
  );
  return Object.freeze({
    getExact(ref: ExactNodeAssetRef | ExactNodeTypeRef) {
      return "assetId" in ref ? byAssetRef.get(exactNodeAssetRefKey(ref)) : byNodeRef.get(exactNodeRefKey(ref));
    },
    getCurrent(assetId: string) {
      return currentByAssetId.get(assetId);
    },
    entries() {
      return frozenEntries;
    },
    paletteEntries() {
      return palette;
    },
    sources() {
      return frozenSources;
    },
  });
}

export function publishNodeAssetVersion(library: NodeAssetLibrary, sourceId: string, value: unknown): NodeAssetLibrary {
  const definition = parseNodeAssetDefinition(value);
  const sources = library.sources();
  const sourceIndex = sources.findIndex((source) => source.sourceId === sourceId);
  if (sourceIndex < 0) throw new Error(`node asset source "${sourceId}" is unavailable`);
  const source = sources[sourceIndex];
  if (source.readOnly) throw new Error(`node asset source "${sourceId}" is read-only`);
  const current = library.getCurrent(definition.assetId);
  if (current && compareSemanticVersions(definition.assetVersion, current.definition.assetVersion) <= 0) {
    throw new Error(
      `published node asset version ${definition.assetVersion} must be newer than ${current.definition.assetVersion}`,
    );
  }
  const historical = library.entries().find((entry) => entry.definition.assetId === definition.assetId);
  if (historical && historical.definition.nodeTypeRef.nodeTypeId !== definition.nodeTypeRef.nodeTypeId) {
    throw new Error(`publishing cannot change node type id for asset "${definition.assetId}"`);
  }
  const nextSource: NodeAssetSource = {
    ...source,
    assets: Object.freeze([...source.assets, definition]),
    current: Object.freeze({ ...source.current, [definition.assetId]: definition.assetVersion }),
  };
  const nextSources = sources.map((candidate, index) => (index === sourceIndex ? nextSource : candidate));
  return createNodeAssetLibrary(nextSources);
}

export function publishUserNodeAsset(
  library: NodeAssetLibrary,
  sourceId: string,
  value: unknown,
  storage: NodeAssetJsonStorage,
): NodeAssetLibrary {
  const next = publishNodeAssetVersion(library, sourceId, value);
  const source = next.sources().find((candidate) => candidate.sourceId === sourceId);
  if (source?.kind !== "user") throw new Error(`node asset source "${sourceId}" is not a user source`);
  storage.replaceAtomically(canonicalUserNodeAssetBytes(source));
  return next;
}

export function canonicalUserNodeAssetBytes(source: NodeAssetSource): string {
  if (source.kind !== "user") throw new Error("only a user node asset source can be persisted");
  return JSON.stringify({
    schemaVersion: 1,
    sourceId: source.sourceId,
    current: sortRecord(source.current ?? {}),
    assets: source.assets,
  });
}

export function loadUserNodeAssetSource(storage: NodeAssetJsonStorage, sourceId = "user"): UserNodeAssetLoadResult {
  const empty = parseSource({ sourceId, kind: "user", assets: [], current: {} });
  let raw: string | null;
  try {
    raw = storage.read();
  } catch (error) {
    return { kind: "recovery", error: errorMessage(error), raw: null, source: empty };
  }
  if (raw === null) return { kind: "miss", source: empty };
  try {
    const parsed = userLibraryDocumentSchema.parse(JSON.parse(raw));
    if (parsed.sourceId !== sourceId) throw new Error(`expected user node asset source "${sourceId}"`);
    return {
      kind: "ok",
      source: parseSource({
        sourceId: parsed.sourceId,
        kind: "user",
        assets: parsed.assets.map(parseNodeAssetDefinition),
        current: parsed.current,
      }),
    };
  } catch (error) {
    return { kind: "recovery", error: errorMessage(error), raw, source: empty };
  }
}

export function linkedAssetRef(assetId: string, assetVersion: string): ExactNodeAssetRef {
  return { assetId: nodeAssetId(assetId), assetVersion: nodeAssetVersion(assetVersion) };
}

function parseSource(source: NodeAssetSource): NodeAssetSource {
  if (!source.sourceId) throw new Error("node asset source id is required");
  const assets = Object.freeze(source.assets.map(parseNodeAssetDefinition));
  const current = source.current ? Object.freeze({ ...source.current }) : undefined;
  for (const [assetId, version] of Object.entries(current ?? {})) {
    if (!assets.some((asset) => asset.assetId === assetId && asset.assetVersion === version)) {
      throw new Error(`source "${source.sourceId}" declares unavailable current asset "${assetId}@${version}"`);
    }
  }
  const readOnly = source.readOnly ?? source.kind !== "user";
  return deepFreeze({
    sourceId: source.sourceId,
    kind: source.kind,
    assets,
    ...(current ? { current } : {}),
    readOnly,
    inPalette: source.inPalette ?? true,
  });
}

function validateDependencies(byAssetRef: ReadonlyMap<string, NodeAssetLibraryEntry>): void {
  for (const entry of byAssetRef.values()) {
    for (const dependency of entry.definition.dependencies) {
      if (dependency.kind === "asset" && !byAssetRef.has(exactNodeAssetRefKey(dependency.assetRef))) {
        throw new Error(
          `node asset "${exactNodeAssetRefKey(entry.definition)}" has missing exact dependency "${exactNodeAssetRefKey(dependency.assetRef)}"`,
        );
      }
    }
  }
}

function validateDependencyCycles(byAssetRef: ReadonlyMap<string, NodeAssetLibraryEntry>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string, trace: readonly string[]): void => {
    if (visiting.has(key)) {
      const start = trace.indexOf(key);
      const cycle = [...trace.slice(start), key];
      throw new Error(`recursive node asset dependency: ${cycle.join(" -> ")}`);
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const definition = byAssetRef.get(key)?.definition;
    for (const dependency of definition?.dependencies ?? []) {
      if (dependency.kind === "asset") visit(exactNodeAssetRefKey(dependency.assetRef), [...trace, key]);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byAssetRef.keys()) visit(key, []);
}

const userLibraryDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceId: z.string().min(1),
    current: z.record(z.string(), z.string()),
    assets: z.array(z.unknown()),
  })
  .strict();

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

export function nodeTypeRefForAsset(ref: ExactNodeAssetRef): ExactNodeTypeRef {
  return exactNodeTypeRef(assetNodeTypeId(ref.assetId), ref.assetVersion);
}
