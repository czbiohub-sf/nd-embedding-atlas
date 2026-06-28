/**
 * Plugin contract — the descriptor layer (PLUGIN-ARCHITECTURE §4).
 *
 * A plugin is a SPLIT descriptor:
 *   - `NodeMeta`   — side-effect-free metadata the registry/node-palette reads
 *                      WITHOUT loading any engine code (TypeGPU, Idetik, ochre…).
 *   - `NodeModule` — the heavy half (Component, options, engine), behind a lazy
 *                      `load() => import("./chunk")`.
 *
 * The contract has ZERO xyflow imports, so the same descriptor mounts in
 * Dockview/Float/PiP today and as an xyflow node later (xyflow = a 4th mount).
 */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { DataCapability } from "@/types";
import type { JsonValue } from "./json";
import type { OptionsBuilder, NodeContext, NodeHost, NodeSessionEvent } from "./host";

export type DescriptorKind = "view" | "transform";

/**
 * Edge payload kinds — the binding vocabulary (.design/VOCABULARY.md):
 *   - `pred`  — a pulled SQL predicate: filter inputs that feed a Mosaic
 *               Selection, and the predicate outputs that drive them. The
 *               default and universal kind.
 *   - `sel`   — a pushed row set (e.g. a lasso's rows).
 *   - `focus` — a pushed single-record highlight (e.g. table row → image viewer).
 */
export type PortKind = "pred" | "sel" | "focus";

/** How a port that accepts >1 edge merges them. v1 ships "and" only (§6.4). */
export type FanInOp = "and" | "or" | "diff";

export interface NodePort {
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

export type NodeCapability =
  | "read" // SELECT against dataset/var (every plugin)
  | "selection-out" // can publish a selection (writes a namespaced temp table)
  | "selection-in" // accepts an upstream selection as a filter
  | "schema-mutate" // /api/categorize, /api/var-column  (scatter only)
  | "spatial" // /api/crop, /api/obs               (viewer, gallery)
  | "collections" // /api/collections, /api/active-selection
  | "gpu" // acquires a WebGPU device lease (scatter)
  | "wasm-bitmap" // owns a Roaring bitmap broadcast source (scatter, gallery)
  | "transform-compute" // server-side DuckDB compute for transforms
  | "annotate" // create/write user annotation columns (/api/annotations/*)
  | "ordering"; // shares sort column/direction on the coordination plane (table)

/**
 * Why an instance is being mounted — threaded through `host.config` hydration so
 * a plugin restores its state declaratively rather than via `initial*` props (§4.4).
 */
export type MountReason = "fresh" | "restore" | "user-add" | "float" | "pip" | "graph-node";

/** Where a freshly-opened instance is placed by the LayoutHost. */
export interface NodePlacement {
  container: "docked" | "slide" | "float";
  side?: "right" | "bottom";
  size?: { w: number; h: number };
}

export type InstancePolicy = "singleton" | "multi" | "unique-per-container";

/**
 * Base node contract — the universal definition shared by every node, built-in
 * or plugin. The SDK is its single home (evolutionary-node-design plan): both
 * `NodeMeta` (view/transform plugins) and built-in graph-node specs extend
 * this. Built-ins add an eager `cook` + `body` workspace-side, where the engine
 * value type resolves; the base stays xyflow-free and engine-free.
 */
export interface NodeSpec {
  /** Unified registry key (the node type id). */
  id: string;
  title: string;
  /** Typed target handles. */
  inputs: NodePort[];
  /** Typed source handles ([] for a sink). */
  outputs: NodePort[];
  /**
   * Runtime schema for this node's serializable `config`, validated on
   * construction / (future) document load via `parseConfig`. zod is the
   * validator at this boundary; swapping to another Standard-Schema validator
   * stays a localized change. Omit for configless nodes.
   */
  config?: ZodType;
  /** Config schema version — bumped when the config shape changes (migration anchor). */
  configVersion?: number;
}

/**
 * Side-effect-free metadata. Importing the barrel that registers these must NOT
 * pull in any engine code (TypeGPU, Idetik, ochre, roaring-wasm). The node
 * palette enumerates THIS only.
 */
export interface NodeMeta extends NodeSpec {
  kind: DescriptorKind;
  capabilities: ReadonlySet<NodeCapability>;

  placement: NodePlacement;
  instancePolicy: InstancePolicy;

  /** Soft cap on concurrent live instances of GPU plugins (decision #4). */
  maxInstances?: number;

  /**
   * Data capabilities this plugin needs to be available, in the shared
   * `DataCapability` vocabulary (CAPABILITY-CONTRACT.md §4). Availability is the
   * subset predicate `requires.every((c) => caps.has(c))` against the dataset's
   * provided set (`capabilitiesOf(metadata)`). Forward-contract alongside
   * `inputs`/`outputs`: it is also the xyflow node port-type used by
   * `isValidConnection`. Omit/empty = always available.
   */
  requires?: readonly DataCapability[];

  /** Lightweight icon name (string token, NOT a ComponentType — no import cost). */
  icon?: string;

  /**
   * Host-API version this plugin targets (semver), checked MAJOR-wise by the
   * registry at registration (`SDK_VERSION` in `./version`). Optional for now —
   * in-tree plugins authored via `defineDescriptor` get the current `SDK_VERSION`
   * stamped automatically; runtime-loaded user plugins MUST declare it so an
   * incompatible build is rejected rather than mis-loaded.
   */
  sdkVersion?: string;
}

/** React render surface for a `view` plugin. */
export interface NodeViewProps<Config = unknown, Options = unknown> {
  host: NodeHost<Config, Options>;
}

/** Optional imperative companion for engine-backed plugins / transforms (§4.4). */
export interface NodeInstance {
  /**
   * `transform` plugins: recompute the output predicate from inputs (§6.8).
   * Receives a per-invocation `NodeContext` carrying the call-scoped
   * `AbortSignal` + graph `epoch`, so a superseded recompute cancels and stale
   * results are dropped.
   */
  recompute?(inputs: ReadonlyMap<string, unknown>, ctx: NodeContext): void;
  /** Optional lifecycle hook (oh-my-pi-style); reserved for Phase 2 transforms/tools. */
  onSession?(event: NodeSessionEvent, ctx: NodeContext): void;
  dispose(): void;
}

/**
 * The heavy half, loaded lazily on first mount. `load()` returns the
 * container-agnostic Component, the typed options builder, and (for engine
 * plugins) the imperative companion factory.
 */
export interface NodeModule<Config = unknown, Options = unknown> {
  Component: ComponentType<NodeViewProps<Config, Options>>;
  /** Serializable defaults — see §4.2. */
  defaultConfig: Config & JsonValue;
  options?: (b: OptionsBuilder<Options>) => void;
  createInstance?: (host: NodeHost<Config, Options>) => NodeInstance;
}

export interface NodeDescriptor<Config = unknown, Options = unknown> extends NodeMeta {
  /** Lazy in-tree chunk. NEVER an external URL (single-binary constraint, §9). */
  load: () => Promise<NodeModule<Config, Options>>;
}
