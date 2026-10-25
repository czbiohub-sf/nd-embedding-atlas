/** Copy a view's reference (`ndea://<workspace>/<element-id>`) for pasting into a harness. */

import { toast } from "sonner";

import { elementReference } from "./edits";
import type { WorkspaceStore } from "./workspace-store";

export async function copyReference(ws: WorkspaceStore, id: string): Promise<void> {
  const reference = elementReference(ws.name, id);
  try {
    await navigator.clipboard.writeText(reference);
    toast(`Copied ${reference}`);
  } catch (error) {
    toast.error(`Could not copy ${reference}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
