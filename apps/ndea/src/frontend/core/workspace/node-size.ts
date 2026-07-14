import type { AppNodeDescriptor } from "@/core/node/library";
import type { WorkspaceNodeSize } from "./types";

export function workspaceNodeSize(def: AppNodeDescriptor, form: "chip" | "card" | "full"): WorkspaceNodeSize {
  if (form === "chip") return { w: def.chipW, h: 26 };
  return form === "full" ? def.full : def.card;
}
