import type { NodeHost, RowIndex } from "@ndea/sdk";
import { useCallback, useSyncExternalStore } from "react";

type FocusHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;

/** React bridge for node host scoped focused observation. */
export function useNodeFocus(host: FocusHost): RowIndex | null {
  const subscribe = useCallback((onChange: () => void) => host.focus.subscribe?.(onChange) ?? (() => {}), [host]);
  const getSnapshot = useCallback(() => host.focus.get(), [host]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
