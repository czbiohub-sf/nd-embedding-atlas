/**
 * Shared OME-Zarr contrast-window resolution.
 *
 * Default OME-Zarr writers often emit `window: {start: 0, end: dtypeMax}` —
 * the full dtype range, not a useful display range. Real fluorescence data
 * fills <10% of the range, so it renders black at full contrast. When we
 * detect that pattern (start==min && end==max with a >1000 span), shrink
 * `end` to 1/16 of the range.
 *
 * Both the live image viewer (`useFovLoader`) and the gallery crop fallback
 * (`useGalleryChannels` → `plateChannelsToDefaults`) MUST use this so a crop
 * thumbnail is contrasted identically to the viewer. Skipping it in the
 * gallery fallback path renders every default-window channel black.
 */

export interface ContrastWindow {
  start: number;
  end: number;
  min: number;
  max: number;
}

/** Resolve an OME window to display [lo, hi], shrinking uninformative full-range defaults. */
export function resolveContrastWindow(window: ContrastWindow | undefined): [number, number] {
  if (!window) return [0, 65535];
  const { start, end, min, max } = window;
  const range = max - min;
  const isUninformativeDefault = start === min && end === max && range > 1000;
  const resolvedEnd = isUninformativeDefault ? min + range / 16 : end;
  return [start, resolvedEnd];
}

/** Ensure contrast limits are strictly increasing — idetik throws if lo >= hi. */
export function safeContrastLimits(limits: [number, number]): [number, number] {
  return limits[0] < limits[1] ? limits : [limits[0], limits[0] + 1];
}
