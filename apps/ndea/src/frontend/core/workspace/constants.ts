/** Node workspace layout and motion constants. */

/** Zoom-semantic render bands: chip < chipMax ≤ card < fullMin ≤ full. */
export const ND_ZOOM = {
  /** chip → card threshold */
  chipMax: 0.55,
  /** card → full-body threshold */
  fullMin: 1.08,
  /** ± band around both thresholds: prevents boundary flapping */
  hysteresis: 0.04,
  /** canvas zoom clamp */
  min: 0.1,
  max: 1.8,
} as const;

/** Motion timings (collapse under prefers-reduced-motion via the global rule). */
export const ND_TIMING = {
  /** strip ↔ full canvas seam: pane rects + camera together */
  seamMs: 420,
  seamEase: "cubic-bezier(0.3, 0.8, 0.3, 1)",
  /** disposition pane geometry (full↔split↔hidden): snappier than a camera
   *  fly-to; ease-out-expo front-loads the motion so it reads as done early */
  dispoMs: 200,
  dispoEase: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** frame morph: width/height/border-radius on form change */
  morphMs: 220,
  morphEase: "cubic-bezier(0.25, 0.8, 0.3, 1)",
  /** inner content cross-fade on form change */
  contentMs: 200,
} as const;

/** NdNodeFrame geometry. */
export const ND_NODE = {
  chipH: 26,
  headerH: 26,
  radius: 7,
  /** resize clamps: per form; chips are canonical (never resized) */
  resizeMin: { card: { w: 150, h: 90 }, full: { w: 200, h: 140 } },
  resizeMax: { w: 780, h: 720 },
} as const;

/** Stage split-tree. */
export const ND_STAGE = {
  /** sash hit area / visible inner line */
  sashHitPx: 8,
  sashLinePx: 2.5,
  minTilePx: 56,
  /** split ratio clamp while dragging a sash */
  ratioMin: 0.12,
  ratioMax: 0.88,
  /** side-column width in full-canvas disposition */
  sideMaxPx: 400,
  sideMaxVw: 0.3,
} as const;

/** Canvas chrome. */
export const ND_CANVAS = {
  dotGridPx: 22,
  minimapW: 156,
  /** wheel zoom sensitivity (exp(-deltaY * k)) */
  wheelZoomK: 0.0016,
} as const;

/** Z-order inside the workspace (canvas-local; app-level layers in app.css). */
export const ND_Z = {
  wires: 2,
  nodes: 3,
  selected: 5,
  claimed: 6,
  ports: 8,
  chrome: 10,
  cursor: 60,
} as const;
