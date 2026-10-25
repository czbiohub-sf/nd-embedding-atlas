/** Dashboard split-tree geometry. */
export const ND_STAGE = {
  /** sash hit area; it overhangs the 4px gutter on both sides */
  sashHitPx: 8,
  minTilePx: 56,
  /** pointer travel before a tab press becomes a drag-to-swap */
  dragStartPx: 4,
  /** split ratio clamp while dragging a sash */
  ratioMin: 0.12,
  ratioMax: 0.88,
} as const;
