/** Split geometry: where a dragged sash puts a split's ratio. Pure, so it is tested without a DOM. */

import { ND_STAGE } from "./constants";

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The first pane's share for a pointer at (`x`, `y`) over the split's `box`:
 * along y for a column split (`horizontal` sash), along x for a row split;
 * clamped so neither pane collapses.
 */
export function sashRatio(box: Box, x: number, y: number, horizontal: boolean): number {
  const ratio = horizontal ? (y - box.top) / box.height : (x - box.left) / box.width;
  return Math.min(ND_STAGE.ratioMax, Math.max(ND_STAGE.ratioMin, ratio));
}
