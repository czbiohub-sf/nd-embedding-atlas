import { useCallback, useSyncExternalStore } from "react";
import type { NodeHost, RowIndex } from "@ndea/sdk";

type FocusNodeHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;

/** The sole React subscription bridge for a node host's focused observation. */
export function useNodeFocus(host: FocusNodeHost): RowIndex | null {
  const subscribe = useCallback((onChange: () => void) => host.focus.subscribe?.(onChange) ?? (() => {}), [host]);
  const getSnapshot = useCallback(() => host.focus.get(), [host]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
