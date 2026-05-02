import { useEffect } from "react";
import { useViewer } from "../viewer/useViewer";

/**
 * Pauses/resumes the idetik render loop based on whether an observation is selected.
 *
 * When paused, the WebGL canvas stops its requestAnimationFrame loop,
 * freeing GPU frame budget for the scatter plot's own WebGL canvas.
 * Must be rendered inside a Viewer.Provider.
 */
export function ViewerPauseGate({ active }: { active: boolean }) {
  const { actions } = useViewer();

  useEffect(() => {
    if (active) {
      actions.resume();
    } else {
      actions.pause();
    }
  }, [active, actions]);

  return null;
}
