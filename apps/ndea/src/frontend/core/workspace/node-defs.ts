export {
  getWorkspaceNodeDescriptor,
  listWorkspaceNodeDescriptors,
  workspacePaletteNodeDescriptors,
} from "./definitions";
export type { WorkspaceNodeDescriptor } from "./node-kit";

import type { WorkspaceNodeDescriptor } from "./node-kit";
import type { WorkspaceNodeSize } from "./types";

export function workspaceNodeSize(def: WorkspaceNodeDescriptor, form: "chip" | "card" | "full"): WorkspaceNodeSize {
  if (form === "chip") return { w: def.chipW, h: 26 };
  return form === "full" ? def.full : def.card;
}
