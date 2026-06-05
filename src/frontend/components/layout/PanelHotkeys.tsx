/**
 * PanelHotkeys — single mount point for the floating-panel keyboard shortcuts.
 * Replaces the per-provider useHotkey calls so registration lives in one place.
 *   ⌘B → Collections (right)   ·   ⌘J → Table (bottom)
 */

import { useHotkey } from "@tanstack/react-hotkeys";
import { togglePanel } from "../../stores/panelRegistry";

export function PanelHotkeys() {
  useHotkey("Mod+B", () => togglePanel("collections"), { preventDefault: true });
  useHotkey("Mod+J", () => togglePanel("table"), { preventDefault: true });
  return null;
}
