/**
 * Workspace graph-document types. The document is the topology +
 * presentation authority; the graph evaluator stays the cook authority
 * (Workspace transactions mirror every mutation into it).
 */

import type { NdForm } from "@/components/node-workspace/nd-resolve-form";
import type { CoordinationSpace } from "@/core/coordination/coordination";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";
import type { WorkspaceNodeAssetRecord } from "@/core/node-asset/schema";
import type { TreeNode } from "./stage/split-tree";

/** where a node's body materializes */
export type WorkspacePlacement = "embedded" | "staged";
/** canvas disposition: a camera/geometry change, never a mode switch.
 *  One emphasis axis: full (wiring fills) ↔ strip (split dock) ↔ hidden
 *  (wiring collapsed to a tab, Stage takes the whole frame). */
export type WorkspaceCanvasDisposition = "strip" | "full" | "hidden";

export interface WorkspaceNodePosition {
  x: number;
  y: number;
}
export interface WorkspaceNodeSize {
  w: number;
  h: number;
}

export interface WorkspaceDocumentState {
  /** Exact linked/embedded asset provenance. Expanded inner nodes never persist. */
  nodeAssets: readonly WorkspaceNodeAssetRecord[];
  nodes: Record<string, GraphDocumentNode>;
  edges: Record<string, GraphDocumentEdge>;
  /** world positions (serialized with the document) */
  positions: Record<string, WorkspaceNodePosition>;
  /** per-form body-size overrides (card/full only; chips canonical) */
  sizeOverrides: Record<string, Partial<Record<"card" | "full", WorkspaceNodeSize>>>;
  formOverride: Record<string, NdForm>;
  formLocked: Record<string, boolean>;
  /** single primary selected node id */
  selectedNodeId: string | null;
  /** marquee-selected node ids */
  selectedNodeIds: string[];
  /** selected edge id (delete chip) */
  selectedEdgeId: string | null;
  /** explicit placement pins: override the by-disposition default, persist */
  explicit: Record<string, WorkspacePlacement>;
  /** stage split-tree layout memory (null → default disposition on demand) */
  stageTree: TreeNode | null;
  /** canvas disposition: docked bottom strip ↔ full canvas */
  disposition: WorkspaceCanvasDisposition;
  /** strip height (px) when docked */
  stripH: number;
  /** embedded body holding the pointer (claiming, M7) */
  claimed: string | null;
  /** current wiring level: null = root, else a subnet id (the canvas is one
   *  surface re-pointed at the inner level; entering refits the camera) */
  graphPath: string | null;
  /** Houdini node flags: bypass (transforms/subnets) · off = display flag down (views) */
  flags: Record<string, { bypass?: boolean; off?: boolean }>;
  /** coordination plane: per-node, per-type scope assignment: which named cell
   *  this node references for each coordination type (e.g. `focus → "A"`). The
   *  N-node identity-of-reference channel, reached only via the host seam. */
  coordinationScopes: Record<string, Record<string, string>>;
  /** coordination plane: the live cells: `type → scope → shared value`.
   *  Focus cells are branded row indices; other types remain `JsonValue`. */
  coordinationSpace: CoordinationSpace;
}
