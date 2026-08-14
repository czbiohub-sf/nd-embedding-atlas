/**
 * Biohub brand and functional UI colors for JavaScript consumers.
 *
 * `app.css` is the primary home for theming: components should use Tailwind
 * utilities or `var(--token)` wherever CSS can reach. This module exists for
 * the cases it cannot:
 *
 *   · SVG presentation attributes set through `setAttribute` do not resolve
 *     `var()`, so the scatter overlays need literal strings.
 *   · Values handed to non-DOM consumers (canvas/WebGPU, ReactFlow props).
 *
 * Values mirror `app.css`. Keep the two in step when editing either: the
 * accent drifted this way before, shipping #644ff6 while every comment claimed
 * #6E4FF9.
 *
 * Source: 2025-11-04 Biohub Brand Book. Not for data color — scientific
 * colormaps and categorical scales live in `ochre-palette.ts` and must keep
 * their published values.
 */

/**
 * Brand periwinkle ramp. `500` is Periwinkle (PMS 2725 C), `800` Iris
 * (PMS 2735 C), `950` Indigo (PMS 273 C); the rest interpolate. Hue is not
 * constant along the ramp, so each stop is its own authoritative value.
 */
export const BRAND_PERIWINKLE = {
  100: "#e6dbff",
  300: "#b195ff",
  400: "#9272fd",
  500: "#6e4ff9",
  800: "#33029c",
  950: "#1d004d",
} as const;

/**
 * Typed wire/port channel colors; mirrors `--color-wire-*`.
 *
 * `pred` carries the brand because the pull channel is the workspace's primary
 * flow. The others borrow non-brand ramp stops shared with the docs syntax
 * theme, chosen for separation: min CIEDE2000 30.9, all ≥4.7:1 on the canvas.
 */
export const WIRE_COLOR = {
  pred: BRAND_PERIWINKLE[400],
  sel: "#ffbc56",
  focus: "#68cdf2",
  feedback: "#60d199",
} as const;

/**
 * Ink for text and glyphs sitting on a saturated badge fill. One near-black
 * for every fill: true-neutral, since the brand's greys carry no hue cast.
 * Clears 5.6:1 on the darkest fill in use.
 */
export const ON_ACCENT_INK = "#0c0c0c";

/**
 * Scope badge colors. Distinct from one another (min CIEDE2000 20.4) and never
 * the feedback channel's jade, so a scope badge cannot read as a feedback wire.
 * Order is load-bearing: `scopeColor()` indexes it by a stable string hash, so
 * appending is safe but reordering re-colors existing scopes.
 */
export const SCOPE_PALETTE = [BRAND_PERIWINKLE[300], "#68cdf2", "#ff855e", "#ffbc56", "#ea68bc"] as const;

/** Trajectory overlay polyline; the active frame lifts to the page ink. */
export const TRAJECTORY_COLOR = "#68cdf2";
