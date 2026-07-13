/**
 * Port anchor positions in world coordinates — shared by the knife layer
 * (wire intersection sampling) and anything else that reasons about wire
 * geometry outside xyflow's own edge rendering.
 */

import { ndResolveForm, type NdForm } from "@/components/nd/nd-resolve-form";
import { workspaceNodeSize } from "../node-defs";
import type { Workspace } from "../workspace-store";
import type { WorkspaceNodeSize, WorkspaceNodePosition } from "../types";

/** y offset of the port center from the node top (rides the 26px header) */
export const PORT_Y = 13;

export function resolveNodeForm(ws: Workspace, id: string): NdForm {
  const node = ws.store.state.nodes[id];
  if (!node) return "card";
  if (node.type === "proxy") return "chip"; // seam markers never grow
  const def = ws.def(id);
  if (!def) return "card";
  const override = ws.store.state.formOverride[id] ?? null;
  return ndResolveForm({
    base: ws.ui.state.baseForm,
    override: override ? { form: override, fresh: true } : null,
    locked: ws.store.state.formLocked[id] ?? false,
    staged: ws.placementOf(id) === "staged", // staged bodies live elsewhere → card max
    canFull: def.canFull,
  });
}

export function resolveNodeSize(ws: Workspace, id: string): WorkspaceNodeSize {
  const node = ws.store.state.nodes[id];
  if (!node) return { w: 0, h: 0 };
  const form = resolveNodeForm(ws, id);
  if (form !== "chip") {
    const o = ws.store.state.sizeOverrides[id]?.[form];
    if (o) return o;
  }
  const descriptor = ws.def(id);
  return descriptor ? workspaceNodeSize(descriptor, form) : { w: 0, h: 0 };
}

export function portPos(ws: Workspace, id: string, which: "in" | "out"): WorkspaceNodePosition {
  const pos = ws.store.state.positions[id] ?? { x: 0, y: 0 };
  if (which === "in") return { x: pos.x, y: pos.y + PORT_Y };
  const { w } = resolveNodeSize(ws, id);
  return { x: pos.x + w, y: pos.y + PORT_Y };
}
