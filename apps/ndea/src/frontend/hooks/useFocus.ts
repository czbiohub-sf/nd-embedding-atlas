import { useSelector } from "@tanstack/react-store";
import type { RowIndex } from "@ndea/sdk";
import { focusBus } from "../core/buses";

/**
 * Reactive read of the focused row from the process-wide FocusBus.
 * Host-scoped consumers should read `host.focus` instead.
 */
export function useFocus(): RowIndex | null {
  return useSelector(focusBus.store, (s) => s);
}
