/**
 * Panel registry: one in-memory store for all floating SlidePanels.
 *
 * Per-session only (no localStorage): panel open/size reset on reload, by design.
 *
 * Exclusive-by-side: opening a panel closes any other panel on the same side, so
 * the two bottom panels (table, devtools) never stack.
 */
import { useSelector } from "@tanstack/react-store";
import { useMemo } from "react";
import { Store } from "@tanstack/store";

export type PanelSide = "right" | "bottom";

export interface PanelState {
  open: boolean;
  /** px: width when side=right, height when side=bottom */
  size: number;
  side: PanelSide;
  minSize: number;
  maxSize: number;
}

type RegistryState = Record<string, PanelState>;

/** Pre-registered panels. Add new floating panels here. */
export const panelStore = new Store<RegistryState>({
  table: { open: false, size: 300, side: "bottom", minSize: 140, maxSize: 900 },
  devtools: { open: false, size: 380, side: "bottom", minSize: 200, maxSize: 900 },
});

function clampSize(p: PanelState, px: number): number {
  const viewportMax = p.side === "bottom" ? window.innerHeight - 80 : window.innerWidth - 80;
  return Math.max(p.minSize, Math.min(Math.min(p.maxSize, viewportMax), px));
}

export function setPanelOpen(id: string, open: boolean): void {
  panelStore.setState((s) => {
    const panel = s[id];
    if (!panel) return s;
    const next: RegistryState = { ...s, [id]: { ...panel, open } };
    // exclusive-by-side: opening one closes the others sharing its side
    if (open) {
      for (const [otherId, other] of Object.entries(s)) {
        if (otherId !== id && other.side === panel.side && other.open) {
          next[otherId] = { ...other, open: false };
        }
      }
    }
    return next;
  });
}

export function togglePanel(id: string): void {
  const panel = panelStore.state[id];
  if (panel) setPanelOpen(id, !panel.open);
}

export function setPanelSize(id: string, px: number): void {
  panelStore.setState((s) => {
    const panel = s[id];
    if (!panel) return s;
    return { ...s, [id]: { ...panel, size: clampSize(panel, px) } };
  });
}

export interface UsePanelResult extends PanelState {
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setSize: (px: number) => void;
}

/** Reactive accessor + bound actions for one panel. */
export function usePanel(id: string): UsePanelResult {
  const state = useSelector(panelStore, (s) => s[id]);
  return useMemo(
    () => ({
      ...(state ?? { open: false, size: 0, side: "right", minSize: 0, maxSize: 0 }),
      toggle: () => togglePanel(id),
      setOpen: (open: boolean) => setPanelOpen(id, open),
      setSize: (px: number) => setPanelSize(id, px),
    }),
    [id, state],
  );
}
