/**
 * Workspace graph-document types. The document is the topology +
 * presentation authority; the graph evaluator stays the cook authority
 * (Workspace transactions mirror every mutation into it).
 */

import type { NdForm } from "@/components/node-workspace/nd-resolve-form";
import type { CoordinationBindings, CoordinationState } from "@/core/coordination/types";
import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";
import type { WorkspaceNodeAssetRecord } from "@/core/node-asset/schema";
import type { Stage } from "./stage/stage-spec";

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
  /** the Stage: a json-render flat spec of Split / View / Slot elements */
  stage: Stage;
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
  /** coordination plane: json-render-style shared state, `type → scope → value`
   *  (see `coordination/types.ts`). Agents patch `/state/<type>/<scope>`. */
  state: CoordinationState;
  /** coordination plane: `node → type → { $bindState: "/<type>/<scope>" }`.
   *  The only way a node joins a scope; reached through the host seam. */
  bindings: CoordinationBindings;
}
