/**
 * Normalized shared-view math for the sweep stage.
 *
 * Camera sync across a sweep CANNOT be world-space. Every FOV carries its own
 * `coordinateTransformations.translation`, so copying slide A's world rect onto
 * slide B's camera aims B at A's plate position and renders empty space. The
 * shared quantity is instead FOV-RELATIVE: a centre and half-width expressed as
 * fractions of each slide's own extent. "The same region of a different
 * reconstruction" only means something under that normalization.
 *
 * Kept pure and separate from `use-sweep-stage` so the conversion is unit-testable
 * without a WebGL context, an idetik runtime, or a DOM.
 */

/** Where a FOV sits in world space and how large it is. */
export interface ViewBounds {
  translation: { x: number; y: number };
  size: { width: number; height: number };
}

/**
 * Shared view: centre normalized per-FOV, zoom carried in WORLD units.
 *
 * The two halves are deliberately different kinds of quantity:
 *
 *  - `cx`/`cy` are fractions of the FOV extent, because each FOV sits at its own
 *    plate translation and a fraction is what makes "the same region" portable.
 *  - `halfW`/`halfH` are absolute world half-extents, NOT fractions. Re-deriving
 *    zoom from a fraction made followers land visibly wider than the card the
 *    user drove: `Viewport.updateAspectRatio()` rewrites the frame after
 *    `setFrame`, so a fraction round-tripped through
 *    `readView -> applyView` accumulated that correction instead of inverting
 *    it. Carrying the world extent transfers zoom exactly.
 */
export interface SharedView {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

/** A world-space camera frame. */
export interface WorldFrame {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/** The whole FOV, in that FOV's own world units. */
export function fullView(bounds: ViewBounds): SharedView {
  return { cx: 0.5, cy: 0.5, halfW: bounds.size.width / 2, halfH: bounds.size.height / 2 };
}

/** Project a shared view into one slide's world coordinates. */
export function viewToWorldFrame(bounds: ViewBounds, view: SharedView): WorldFrame {
  const { translation, size } = bounds;
  const centreX = translation.x + view.cx * size.width;
  const centreY = translation.y + view.cy * size.height;
  return {
    left: centreX - view.halfW,
    right: centreX + view.halfW,
    bottom: centreY - view.halfH,
    top: centreY + view.halfH,
  };
}

/** Read a world-space rect back into a shared view. Exactly inverts the above. */
export function worldRectToView(
  bounds: ViewBounds,
  rect: { x: number; y: number; width: number; height: number },
): SharedView {
  const { translation, size } = bounds;
  return {
    cx: (rect.x + rect.width / 2 - translation.x) / size.width,
    cy: (rect.y + rect.height / 2 - translation.y) / size.height,
    halfW: rect.width / 2,
    halfH: rect.height / 2,
  };
}

/** Views equal within tolerance, to suppress per-frame float echo. */
export function sameView(a: SharedView, b: SharedView): boolean {
  return (
    Math.abs(a.cx - b.cx) < 1e-6 &&
    Math.abs(a.cy - b.cy) < 1e-6 &&
    Math.abs(a.halfW - b.halfW) < 1e-4 &&
    Math.abs(a.halfH - b.halfH) < 1e-4
  );
}
