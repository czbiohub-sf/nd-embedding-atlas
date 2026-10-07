/**
 * Workspace types. The document is the persisted topology + presentation
 * authority the server owns; the session is this tab's editor state
 * (selection, claim, subnet path, disposition, transient UI) and never
 * leaves the browser.
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

/** Exactly the persisted workspace document (`workspaceDocumentSchema`). */
export interface WorkspaceDocument {
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
  /** the Stage: a json-render flat spec of Split / View / Slot elements */
  stage: Stage;
  /** strip height (px) when docked */
  stripH: number;
  /** Houdini node flags: bypass (transforms/subnets) · off = display flag down (views) */
  flags: Record<string, { bypass?: boolean; off?: boolean }>;
  /** coordination plane: json-render-style shared state, `type → scope → value`
   *  (see `coordination/types.ts`). Agents patch `/state/<type>/<scope>`. */
  state: CoordinationState;
  /** coordination plane: `node → type → { $bindState: "/<type>/<scope>" }`.
   *  The only way a node joins a scope; reached through the host seam. */
  bindings: CoordinationBindings;
}

/** FLIP relocation ghost (pin/pull) */
export interface GhostState {
  from: DOMRect;
  to: DOMRect;
  label: string;
}

/** This tab's editor state. Never persisted, never synced. */
export interface WorkspaceSession {
  /** single primary selected node id */
  selectedNodeId: string | null;
  /** marquee-selected node ids */
  selectedNodeIds: string[];
  /** selected edge id (delete chip) */
  selectedEdgeId: string | null;
  /** embedded body holding the pointer (claiming, M7) */
  claimed: string | null;
  /** current wiring level: null = root, else a subnet id (the canvas is one
   *  surface re-pointed at the inner level; entering refits the camera) */
  graphPath: string | null;
  /** canvas disposition: docked bottom strip ↔ full canvas */
  disposition: WorkspaceCanvasDisposition;
  /** global render band. Forms default LOCKED to the largest view (baseForm
   *  "full"; capability/placement still cap); zoomForms opts into zoom bands. */
  baseForm: NdForm;
  zoomForms: boolean;
  ghost: GhostState | null;
  flipHide: string | null;
  /** morph suppression during a body resize drag */
  resizing: string | null;
  /** node whose body fills the workspace (third dock adopter); esc exits */
  fullscreen: string | null;
  assetAuthoring: { mode: "create" } | { mode: "edit"; nodeId: string } | null;
}
