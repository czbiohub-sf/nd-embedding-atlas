import type { ComponentHost, RowIndex } from "@ndea/sdk";
import { useCallback, useSyncExternalStore } from "react";

/** React bridge for the host's focused row. */
export function useFocus(host: Pick<ComponentHost, "focus">): RowIndex | null {
  const subscribe = useCallback((onChange: () => void) => host.focus.subscribe?.(onChange) ?? (() => {}), [host]);
  const getSnapshot = useCallback(() => host.focus.get(), [host]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
