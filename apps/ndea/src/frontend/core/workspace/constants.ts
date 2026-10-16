/** Dashboard split-tree geometry. */
export const ND_STAGE = {
  /** sash hit area / visible inner line */
  sashHitPx: 8,
  sashLinePx: 2.5,
  minTilePx: 56,
  /** split ratio clamp while dragging a sash */
  ratioMin: 0.12,
  ratioMax: 0.88,
} as const;
