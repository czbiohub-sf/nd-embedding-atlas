/**
 * Plugin contract — the descriptor layer (PLUGIN-ARCHITECTURE §4).
 *
 * A plugin is a SPLIT descriptor:
 *   - `PluginMeta`   — side-effect-free metadata the registry/node-palette reads
 *                      WITHOUT loading any engine code (TypeGPU, Idetik, ochre…).
 *   - `PluginModule` — the heavy half (Component, options, engine), behind a lazy
 *                      `load() => import("./chunk")`.
 *
 * The contract has ZERO xyflow imports, so the same descriptor mounts in
 * Dockview/Float/PiP today and as an xyflow node later (xyflow = a 4th mount).
 */

import type { ComponentType } from "react";
import type { JsonValue } from "./json";
import type { OptionsBuilder, PluginHost } from "./host";

export type PluginKind = "view" | "transform";

/** Edge payload types. `selection` is the default and universal one. */
export type PortKind = "selection" | "predicate" | "rowset";

/** How a port that accepts >1 edge merges them. v1 ships "and" only (§6.4). */
export type FanInOp = "and" | "or" | "diff";

export interface PluginPort {
  /** → xyflow Handle id (sourceHandle / targetHandle). */
  id: string;
  /** → isValidConnection type check. */
  kind: PortKind;
  label: string;
  /** If true, accepts >1 incoming edge; `fanIn` then declares the reducer. */
  multiple?: boolean;
  /** Required when `multiple === true`. v1: must be "and". */
  fanIn?: FanInOp;
}

export type PluginCapability =
  | "read" // SELECT against dataset/var (every plugin)
  | "selection-out" // can publish a selection (writes a namespaced temp table)
  | "selection-in" // accepts an upstream selection as a filter
  | "schema-mutate" // /api/categorize, /api/var-column  (scatter only)
  | "spatial" // /api/crop, /api/obs               (viewer, gallery)
  | "collections" // /api/collections, /api/active-selection
  | "gpu" // acquires a WebGPU device lease (scatter)
  | "wasm-bitmap" // owns a Roaring bitmap broadcast source (scatter, gallery)
  | "transform-compute"; // server-side DuckDB compute for transforms

/**
 * Why an instance is being mounted — threaded through `host.config` hydration so
 * a plugin restores its state declaratively rather than via `initial*` props (§4.4).
 */
export type MountReason = "fresh" | "restore" | "user-add" | "float" | "pip" | "graph-node";

/** Where a freshly-opened instance is placed by the LayoutHost. */
export interface PluginPlacement {
  container: "docked" | "slide" | "float";
  side?: "right" | "bottom";
  size?: { w: number; h: number };
}

export type InstancePolicy = "singleton" | "multi" | "unique-per-container";

/**
 * Side-effect-free metadata. Importing the barrel that registers these must NOT
 * pull in any engine code (TypeGPU, Idetik, ochre, roaring-wasm). The node
 * palette enumerates THIS only.
 */
export interface PluginMeta {
  /** Unified registry key. */
  id: string;
  title: string;
  kind: PluginKind;

  /** Typed target handles. */
  inputs: PluginPort[];
  /** Typed source handles. */
  outputs: PluginPort[];
  capabilities: ReadonlySet<PluginCapability>;

  placement: PluginPlacement;
  instancePolicy: InstancePolicy;

  /** Soft cap on concurrent live instances of GPU plugins (decision #4). */
  maxInstances?: number;

  /** VS Code `when`-style availability gate against the loaded dataset. */
  isAvailable?: (ctx: DataAvailabilityContext) => boolean;

  /** Lightweight icon name (string token, NOT a ComponentType — no import cost). */
  icon?: string;
}

/** Minimal context for `isAvailable` checks — kept tiny so it stays cheap. */
export interface DataAvailabilityContext {
  hasEmbeddings: boolean;
  hasPlate: boolean;
  hasVar: boolean;
  modalities: string[];
}

/** React render surface for a `view` plugin. */
export interface PluginViewProps<Config = unknown, Options = unknown> {
  host: PluginHost<Config, Options>;
}

/** Optional imperative companion for engine-backed plugins / transforms (§4.4). */
export interface PluginInstance {
  /**
   * `transform` plugins: recompute the output predicate from inputs (§6.8).
   * Receives the graph epoch so stale results can be dropped.
   */
  recompute?(inputs: ReadonlyMap<string, unknown>, epoch: number): void;
  dispose(): void;
}

/**
 * The heavy half, loaded lazily on first mount. `load()` returns the
 * container-agnostic Component, the typed options builder, and (for engine
 * plugins) the imperative companion factory.
 */
export interface PluginModule<Config = unknown, Options = unknown> {
  Component: ComponentType<PluginViewProps<Config, Options>>;
  /** Serializable defaults — see §4.2. */
  defaultConfig: Config & JsonValue;
  options?: (b: OptionsBuilder<Options>) => void;
  createInstance?: (host: PluginHost<Config, Options>) => PluginInstance;
}

export interface PluginDescriptor<Config = unknown, Options = unknown> extends PluginMeta {
  /** Lazy in-tree chunk. NEVER an external URL (single-binary constraint, §9). */
  load: () => Promise<PluginModule<Config, Options>>;
}
