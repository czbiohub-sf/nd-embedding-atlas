/**
 * Recipes — named bundles of Tailwind class strings for recurring patterns.
 *
 * Each export is just a string. Compose with `cn()` at call sites:
 *
 *   import { glassSurface } from "@/lib/recipes";
 *   <div className={cn(glassSurface, "p-3")} />
 *
 * Rationale: stops drift from copy-pasted class lists. Rename a token like
 * `--glass-bg` once; every call site using `glassSurface` picks it up.
 * Same mechanism CVA uses under the hood — recipes are the zero-variant case.
 */

// Focus ring — buttons, inputs, interactive surfaces.
// Matches the @utility focus-ring in app.css but composable via cn().
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:border-ring";

// Solid panel surface — sidebars, docked cards. Uses canonical shadcn tokens.
export const panelSurface = "rounded-lg border border-border bg-card";

// Glass HUD surface — floating overlays on top of the canvas.
// Backed by --glass-bg / --glass-border / --blur-glass from Phase 1.
export const glassSurface = "rounded-lg border border-glass-border bg-glass-bg backdrop-blur-[var(--blur-glass)]";

// Monospace data display — numeric readouts, keyboard shortcuts, timestamps.
export const dataMono = "font-mono tabular-nums";
