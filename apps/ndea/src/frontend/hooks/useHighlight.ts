import { useSelector } from "@tanstack/react-store";
import { highlightBus } from "../core/buses";

/**
 * Reactive read of the highlighted row id from the HighlightBus (§6.7). The
 * host-driven counterpart to `host.highlight.set`; lets a plugin react to
 * highlight changes without reaching into `useDashboard().state`.
 */
export function useHighlight(): string | null {
  return useSelector(highlightBus.store, (s) => s);
}
