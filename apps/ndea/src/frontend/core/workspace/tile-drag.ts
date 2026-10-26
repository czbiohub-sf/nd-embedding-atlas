/**
 * Tile drag: a tab press becomes a drag after a few px of travel, so a plain
 * click stays a click. Hit-testing reads the tile chrome's data attributes
 * (`data-tab-strip`, `data-dashboard-tile`); the drop is one named edit
 * (`dropEdit`): a tab dropped on another tile's tab strip moves there
 * (`move_tab`; its body stays alive), anything dropped on a tile body swaps
 * the two tiles (`swap`).
 */

import { createContext, use, useRef, useState } from "react";

import { ND_STAGE } from "./constants";
import type { DashboardEdit } from "./edits";

/** A dragged tile (by its tab strip) or one tab of it; `strip` says `over` is a tab strip, not a tile body. */
export interface DragState {
  readonly tile: string;
  readonly tab?: string;
  readonly over: string | null;
  readonly strip: boolean;
}

export interface TileDrag {
  readonly drag: DragState | null;
  beginDrag(from: { tile: string; tab?: string }, start: React.PointerEvent): void;
}

/** The edit a drop makes, or null when it lands nowhere or on its own tile. */
export function dropEdit(drag: DragState): DashboardEdit | null {
  if (!drag.over || drag.over === drag.tile) return null;
  if (drag.strip && drag.tab) return { op: "move_tab", id: drag.tab, to: drag.over };
  return { op: "swap", a: drag.tile, b: drag.over };
}

/** What is under the pointer: a tab strip (only while dragging a tab), else a tile body, else nothing. */
function hitTest(x: number, y: number, tab: boolean): { over: string | null; strip: boolean } {
  const under = document.elementFromPoint(x, y);
  const strip = tab ? under?.closest?.("[data-tab-strip]") : null;
  if (strip) return { over: strip.getAttribute("data-tab-strip"), strip: true };
  return { over: under?.closest?.("[data-dashboard-tile]")?.getAttribute("data-dashboard-tile") ?? null, strip: false };
}

/** The pane's drag controller: the live drag (for drop-target rings) and its pointer lifecycle. */
export function useTileDragController(onDrop: (edit: DashboardEdit) => void): TileDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const beginDrag = (from: { tile: string; tab?: string }, start: React.PointerEvent) => {
    if (start.button !== 0) return;
    const { clientX, clientY } = start;
    const move = (ev: PointerEvent) => {
      if (!dragRef.current && Math.hypot(ev.clientX - clientX, ev.clientY - clientY) < ND_STAGE.dragStartPx) return;
      const { over, strip } = hitTest(ev.clientX, ev.clientY, from.tab !== undefined);
      if (dragRef.current?.over === over && dragRef.current.strip === strip) return;
      dragRef.current = { ...from, over, strip };
      setDrag(dragRef.current);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      const current = dragRef.current;
      if (!current) return;
      dragRef.current = null;
      setDrag(null);
      const edit = ev.type === "pointerup" ? dropEdit(current) : null;
      if (edit) onDrop(edit);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return { drag, beginDrag };
}

export const TileDragContext = createContext<TileDrag | null>(null);

export function useTileDrag(): TileDrag {
  const value = use(TileDragContext);
  if (!value) throw new Error("tiles render inside DashboardPane");
  return value;
}
