import { useEffect } from "react";
import type { RowIndex } from "@ndea/sdk";
import { useViewer } from "@/nodes/image-viewer/viewer/useViewer";
import { syncViewerActivity } from "./focus-behavior";

/**
 * Pauses/resumes the idetik render loop based on whether an observation is selected.
 *
 * When paused, the WebGL canvas stops its requestAnimationFrame loop,
 * freeing GPU frame budget for the scatter plot's own WebGL canvas.
 * Must be rendered inside a Viewer.Provider.
 */
export function ViewerPauseGate({ focusedRowIndex }: { focusedRowIndex: RowIndex | null }) {
  const { actions } = useViewer();

  useEffect(() => {
    syncViewerActivity(actions, focusedRowIndex);
  }, [focusedRowIndex, actions]);

  return null;
}
