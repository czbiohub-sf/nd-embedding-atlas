import type { ExactNodeTypeRef } from "@ndea/sdk";

import { nodeDescriptorOf, type AppNodeLibrary, type AppNodeSpec } from "@/core/node/library";
import { compileNodeAsset, type CompiledNodeAsset, type NodeAssetExpansionDescriptor } from "./compiler";
import { createNodeAssetLibrary, nodeTypeRefForAsset, type NodeAssetLibrary } from "./library";
import {
  exactNodeAssetRefKey,
  exactNodeRefKey,
  parseWorkspaceNodeAssetRecords,
  type NodeAssetDefinition,
  type WorkspaceNodeAssetRecord,
} from "./schema";

export interface CompiledNodeAssetSnapshot {
  readonly assets: NodeAssetLibrary;
  getSpecExact(ref: ExactNodeTypeRef): AppNodeSpec | undefined;
  getExpansionExact(ref: ExactNodeTypeRef): NodeAssetExpansionDescriptor | undefined;
  specs(): readonly AppNodeSpec[];
  diagnostics(): readonly NodeAssetCompileDiagnostic[];
}

export interface NodeAssetCompileDiagnostic {
  readonly definitionRef: ExactNodeTypeRef;
  readonly sourceId: string;
  readonly message: string;
}

export interface WorkspaceNodeAssetResolution {
  readonly snapshot: CompiledNodeAssetSnapshot;
  readonly records: readonly WorkspaceNodeAssetRecord[];
  readonly statusByNodeTypeRef: Readonly<Record<string, "linked" | "fallback" | "embedded" | "unresolved">>;
}

export interface WorkspaceAppNodeLibrary extends AppNodeLibrary {
  getAssetExpansionExact(ref: ExactNodeTypeRef): NodeAssetExpansionDescriptor | undefined;
  replaceAssetSnapshot(snapshot: CompiledNodeAssetSnapshot): void;
  assetSnapshot(): CompiledNodeAssetSnapshot;
  baseLibrary(): AppNodeLibrary;
}

export function compileNodeAssetSnapshot(
  base: Pick<AppNodeLibrary, "getSpecExact">,
  assets: NodeAssetLibrary,
): CompiledNodeAssetSnapshot {
  const compiledByRef = new Map<string, CompiledNodeAsset>();
  const compiling: string[] = [];
  const compile = (ref: ExactNodeTypeRef): CompiledNodeAsset => {
    const key = exactNodeRefKey(ref);
    const existing = compiledByRef.get(key);
    if (existing) return existing;
    const cycleAt = compiling.indexOf(key);
    if (cycleAt >= 0)
      throw new Error(`recursive node asset compile: ${[...compiling.slice(cycleAt), key].join(" -> ")}`);
    const entry = assets.getExact(ref);
    if (!entry) throw new Error(`node asset definition "${key}" is unavailable`);
    compiling.push(key);
    try {
      for (const dependency of entry.definition.dependencies) {
        if (dependency.kind !== "asset") continue;
        compile(nodeTypeRefForAsset(dependency.assetRef));
      }
      const compiled = compileNodeAsset(
        entry.definition,
        {
          getSpecExact(candidate) {
            return base.getSpecExact(candidate) ?? compiledByRef.get(exactNodeRefKey(candidate))?.spec;
          },
          getCurrentSpec(nodeTypeId) {
            return "getCurrentSpec" in base && typeof base.getCurrentSpec === "function"
              ? base.getCurrentSpec(nodeTypeId)
              : undefined;
          },
        },
        { sourceId: entry.source.sourceId, kind: entry.source.kind },
      );
      compiledByRef.set(key, compiled);
      return compiled;
    } finally {
      compiling.pop();
    }
  };
  const diagnostics: NodeAssetCompileDiagnostic[] = [];
  for (const entry of assets.entries()) {
    try {
      compile(entry.definition.nodeTypeRef);
    } catch (error) {
      diagnostics.push(
        Object.freeze({
          definitionRef: entry.definition.nodeTypeRef,
          sourceId: entry.source.sourceId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  const specs = Object.freeze([...compiledByRef.values()].map((compiled) => compiled.spec));
  const frozenDiagnostics = Object.freeze(diagnostics);
  return Object.freeze({
    assets,
    getSpecExact(ref: ExactNodeTypeRef) {
      return compiledByRef.get(exactNodeRefKey(ref))?.spec;
    },
    getExpansionExact(ref: ExactNodeTypeRef) {
      return compiledByRef.get(exactNodeRefKey(ref))?.expansion;
    },
    specs() {
      return specs;
    },
    diagnostics() {
      return frozenDiagnostics;
    },
  });
}

export function resolveWorkspaceNodeAssets(
  base: Pick<AppNodeLibrary, "getSpecExact">,
  rawAvailable: NodeAssetLibrary,
  rawRecords: unknown,
): WorkspaceNodeAssetResolution {
  const records = parseWorkspaceNodeAssetRecords(rawRecords);
  const claimedSources = new Map<string, string | null>();
  for (const record of records) {
    if (record.kind === "linked") claimedSources.set(exactNodeRefKey(record.nodeTypeRef), record.sourceId);
    else claimedSources.set(exactNodeRefKey(record.definition.nodeTypeRef), null);
  }
  // A live snapshot also contains overlays from the previously loaded
  // Workspace. Rebuild those only from this document's records. Embedded
  // records own their exact bytes; linked records accept only their source.
  const sourceAssets = rawAvailable.sources().flatMap((source) => {
    if (source.kind === "embedded") return [];
    return [
      {
        source,
        assets: source.assets.filter((definition) => {
          const key = exactNodeRefKey(definition.nodeTypeRef);
          return !claimedSources.has(key) || claimedSources.get(key) === source.sourceId;
        }),
      },
    ];
  });
  let changed = true;
  while (changed) {
    changed = false;
    const assetKeys = new Set(
      sourceAssets.flatMap(({ assets }) => assets.map((definition) => exactNodeAssetRefKey(definition))),
    );
    for (const entry of sourceAssets) {
      const retained = entry.assets.filter((definition) =>
        definition.dependencies.every(
          (dependency) => dependency.kind !== "asset" || assetKeys.has(exactNodeAssetRefKey(dependency.assetRef)),
        ),
      );
      if (retained.length !== entry.assets.length) {
        entry.assets = retained;
        changed = true;
      }
    }
  }
  const available = createNodeAssetLibrary(
    sourceAssets.map(({ source, assets }) => {
      const current = Object.fromEntries(
        Object.entries(source.current ?? {}).filter(([assetId, assetVersion]) =>
          assets.some(
            (definition) => definition.assetId === assetId && String(definition.assetVersion) === assetVersion,
          ),
        ),
      );
      return { ...source, assets, ...(source.current ? { current } : {}) };
    }),
  );
  const embeddedAssets: NodeAssetDefinition[] = [];
  const fallbackAssets: NodeAssetDefinition[] = [];
  const embeddedCurrent: Record<string, string> = {};
  const fallbackCurrent: Record<string, string> = {};
  const statusByNodeTypeRef: Record<string, "linked" | "fallback" | "embedded" | "unresolved"> = {};
  for (const record of records) {
    if (record.kind === "embedded") {
      addPortableDefinition(available, embeddedAssets, record.definition);
      embeddedCurrent[record.definition.assetId] = record.definition.assetVersion;
      statusByNodeTypeRef[exactNodeRefKey(record.definition.nodeTypeRef)] = "embedded";
      continue;
    }
    const linked = available.getExact(record.assetRef);
    if (
      linked &&
      linked.source.sourceId === record.sourceId &&
      exactNodeRefKey(linked.definition.nodeTypeRef) === exactNodeRefKey(record.nodeTypeRef)
    ) {
      if (record.fallback && !nodeAssetDefinitionsEqual(linked.definition, record.fallback)) {
        throw new Error(`linked node asset differs from exact fallback "${exactNodeAssetRefKey(record.assetRef)}"`);
      }
      statusByNodeTypeRef[exactNodeRefKey(record.nodeTypeRef)] = "linked";
      continue;
    }
    if (record.fallback) {
      addPortableDefinition(available, fallbackAssets, record.fallback);
      fallbackCurrent[record.fallback.assetId] = record.fallback.assetVersion;
      statusByNodeTypeRef[exactNodeRefKey(record.nodeTypeRef)] = "fallback";
      continue;
    }
    statusByNodeTypeRef[exactNodeRefKey(record.nodeTypeRef)] = "unresolved";
  }
  const sources = [...available.sources()];
  if (embeddedAssets.length > 0) {
    sources.push({
      sourceId: "workspace",
      kind: "embedded",
      assets: embeddedAssets,
      current: embeddedCurrent,
      readOnly: true,
    });
  }
  if (fallbackAssets.length > 0) {
    sources.push({
      sourceId: "workspace-fallback",
      kind: "embedded",
      assets: fallbackAssets,
      current: fallbackCurrent,
      readOnly: true,
      inPalette: false,
    });
  }
  const assets = createNodeAssetLibrary(sources);
  const snapshot = compileNodeAssetSnapshot(base, assets);
  for (const record of records) {
    const ref = record.kind === "linked" ? record.nodeTypeRef : record.definition.nodeTypeRef;
    if (!snapshot.getSpecExact(ref)) statusByNodeTypeRef[exactNodeRefKey(ref)] = "unresolved";
  }
  return Object.freeze({
    snapshot,
    records,
    statusByNodeTypeRef: Object.freeze(statusByNodeTypeRef),
  });
}

export function createWorkspaceAppNodeLibrary(
  base: AppNodeLibrary,
  initial: CompiledNodeAssetSnapshot = compileNodeAssetSnapshot(base, createNodeAssetLibrary([])),
): WorkspaceAppNodeLibrary {
  let snapshot = initial;
  let view = compose(base, snapshot);
  return Object.freeze({
    catalog: base.catalog,
    getSpecExact(ref: ExactNodeTypeRef) {
      return view.getSpecExact(ref);
    },
    getCurrentSpec(nodeTypeId: string) {
      return view.getCurrentSpec(nodeTypeId);
    },
    getDescriptorExact(ref: ExactNodeTypeRef) {
      return view.getDescriptorExact(ref);
    },
    getCurrentDescriptor(nodeTypeId: string) {
      return view.getCurrentDescriptor(nodeTypeId);
    },
    listSpecs() {
      return view.listSpecs();
    },
    listDescriptors() {
      return view.listDescriptors();
    },
    paletteDescriptors() {
      return view.paletteDescriptors();
    },
    getAssetExpansionExact(ref: ExactNodeTypeRef) {
      return snapshot.getExpansionExact(ref);
    },
    replaceAssetSnapshot(next: CompiledNodeAssetSnapshot) {
      const nextView = compose(base, next);
      snapshot = next;
      view = nextView;
    },
    assetSnapshot() {
      return snapshot;
    },
    baseLibrary() {
      return base;
    },
  });
}

function compose(base: AppNodeLibrary, snapshot: CompiledNodeAssetSnapshot): AppNodeLibrary {
  const assetSpecs = snapshot.specs();
  const assetDescriptors = Object.freeze(assetSpecs.map(nodeDescriptorOf));
  const descriptorsByRef = new Map(
    assetDescriptors.map((descriptor) => [exactNodeRefKey(descriptor.definitionRef), descriptor]),
  );
  const specs = Object.freeze([...base.listSpecs(), ...assetSpecs]);
  const descriptors = Object.freeze([...base.listDescriptors(), ...assetDescriptors]);
  const palette = Object.freeze([
    ...base.paletteDescriptors(),
    ...snapshot.assets.paletteEntries().flatMap((entry) => {
      const descriptor = descriptorsByRef.get(exactNodeRefKey(entry.definition.nodeTypeRef));
      return descriptor ? [descriptor] : [];
    }),
  ]);
  return {
    catalog: base.catalog,
    getSpecExact(ref) {
      return snapshot.getSpecExact(ref) ?? base.getSpecExact(ref);
    },
    getCurrentSpec(nodeTypeId) {
      if (!nodeTypeId.startsWith("asset/")) return base.getCurrentSpec(nodeTypeId);
      const current = snapshot.assets.getCurrent(nodeTypeId.slice("asset/".length));
      return current ? snapshot.getSpecExact(current.definition.nodeTypeRef) : undefined;
    },
    getDescriptorExact(ref) {
      return descriptorsByRef.get(exactNodeRefKey(ref)) ?? base.getDescriptorExact(ref);
    },
    getCurrentDescriptor(nodeTypeId) {
      if (!nodeTypeId.startsWith("asset/")) return base.getCurrentDescriptor(nodeTypeId);
      const current = snapshot.assets.getCurrent(nodeTypeId.slice("asset/".length));
      return current ? descriptorsByRef.get(exactNodeRefKey(current.definition.nodeTypeRef)) : undefined;
    },
    listSpecs() {
      return specs;
    },
    listDescriptors() {
      return descriptors;
    },
    paletteDescriptors() {
      return palette;
    },
  };
}

function addPortableDefinition(
  available: NodeAssetLibrary,
  target: NodeAssetDefinition[],
  definition: NodeAssetDefinition,
): void {
  const existing = available.getExact(definition.nodeTypeRef);
  if (!existing) {
    target.push(definition);
    return;
  }
  if (!nodeAssetDefinitionsEqual(existing.definition, definition)) {
    throw new Error(`Workspace node asset collides with available definition "${exactNodeAssetRefKey(definition)}"`);
  }
}

function nodeAssetDefinitionsEqual(left: NodeAssetDefinition, right: NodeAssetDefinition): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}
