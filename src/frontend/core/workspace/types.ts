/**
 * Workspace graph-document types. The document is the topology +
 * presentation authority; the GraphEngine stays the cook authority
 * (workspace-store mirrors every mutation into it).
 *
 * Vocabulary per .design/VOCABULARY.md: node kinds source · transform ·
 * view · selection (subnet/proxy arrive with hierarchy); port kinds
 * pred · sel · focus; placement embedded · staged.
 */

import type { NdForm } from "@/components/nd/nd-resolve-form";
import type { NdPortKind } from "@/components/nd/nd-port";
import type { JsonValue } from "@/core/node/json";
import type { TreeNode } from "./stage/split-tree";

/**
 * The value flowing on workspace wires — a tagged union over the three port
 * kinds. pred is DERIVED (cooks compute it); sel/focus are AUTHORED
 * (engine emissions — they exist because the user acted).
 */
export type WsValue =
  | { kind: "pred"; sql: string | null }
  | { kind: "sel"; sql: string | null; rowIds: readonly number[] | null }
  | { kind: "focus"; obsId: string | null };

/** where a node's body materializes */
export type WsPlacement = "embedded" | "staged";
/** canvas disposition — a camera/geometry change, never a mode switch */
export type WsDisposition = "strip" | "full";

// "cache" is the source-agnostic checkpoint kind. "selection" is its retired
// predecessor — kept in the union (deprecated, not deleted) so older documents
// that persisted a Selection node still deserialize.
export type WsNodeKind = "source" | "transform" | "view" | "cache" | "selection" | "subnet" | "proxy";

/** Workspace node type — keys into NODE_DEFS (palette + geometry + cook wiring). */
export type WsNodeType =
  | "obs"
  | "dataset"
  | "threshold"
  | "wrangle"
  | "annotate"
  | "count"
  | "table"
  | "scatter"
  | "count-plot"
  | "histogram"
  | "gallery"
  | "fov"
  | "collection"
  | "export"
  | "cache"
  // deprecated — superseded by "cache"; retained so old documents still load.
  | "selection"
  | "subnet"
  | "proxy";

export interface WsNode {
  id: string;
  type: WsNodeType;
  kind: WsNodeKind;
  label: string;
  /** registry id when the body is a real plugin (table/scatter/gallery/fov/threshold) */
  pluginId: string | null;
  /** hierarchy level (M5); null/undefined = root */
  parent?: string | null;
  /** cache/selection nodes: the epoch the pinned row-set was stamped at
   *  (undefined = uncached/live — passes its input through). Ephemeral engine
   *  pin-marker, not document config — stays flat. */
  stamp?: number;
  /** per-node serializable document config (config-blob), validated via the SDK
   *  `parseConfig` against the node spec's schema. Holds wrangle `prql`, dataset
   *  `datasetKey`, collection `collectionId`/`collectionName`. */
  config?: JsonValue;
}

export interface WsEdge {
  id: string;
  from: string;
  to: string;
  /** fan-in grouping key on the target (engine toPort) */
  toPort: string;
  kind: NdPortKind;
}

export interface XY {
  x: number;
  y: number;
}
export interface WH {
  w: number;
  h: number;
}

export interface WsState {
  nodes: Record<string, WsNode>;
  edges: Record<string, WsEdge>;
  /** world positions (serialized with the document) */
  positions: Record<string, XY>;
  /** per-form body-size overrides (card/full only; chips canonical) */
  sizeOverrides: Record<string, Partial<Record<"card" | "full", WH>>>;
  formOverride: Record<string, NdForm>;
  formLocked: Record<string, boolean>;
  /** single primary selection (node id) */
  selection: string | null;
  /** marquee multi-selection */
  selSet: string[];
  /** selected edge (delete chip) */
  selectedEdge: string | null;
  /** explicit placement pins — override the by-disposition default, persist */
  explicit: Record<string, WsPlacement>;
  /** stage split-tree layout memory (null → default disposition on demand) */
  stageTree: TreeNode | null;
  /** canvas disposition: docked bottom strip ↔ full canvas */
  disposition: WsDisposition;
  /** strip height (px) when docked */
  stripH: number;
  /** embedded body holding the pointer (claiming, M7) */
  claimed: string | null;
  /** current wiring level — null = root, else a subnet id (the canvas is one
   *  surface re-pointed at the inner level; entering refits the camera) */
  graphPath: string | null;
  /** Houdini node flags: bypass (transforms/subnets) · off = display flag down (views) */
  flags: Record<string, { bypass?: boolean; off?: boolean }>;
  /** coordination plane — per-node, per-type scope assignment: which named cell
   *  this node references for each coordination type (e.g. `focus → "A"`). The
   *  N-node identity-of-reference channel, reached only via the host seam. */
  coordinationScopes: Record<string, Record<string, string>>;
  /** coordination plane — the live cells: `type → scope → shared value`
   *  (latest-wins, `JsonValue`-only). */
  coordinationSpace: Record<string, Record<string, JsonValue>>;
}
