/** Compile-time feature switches shared by the frontend entry and workspace surfaces. */

export function resolveNodeEditorEnabled(dev: boolean, value?: string): boolean {
  if (value === undefined) return dev;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`VITE_NDEA_NODE_EDITOR must be "true" or "false", received "${value}"`);
}

/**
 * Enabled by default under `vp dev`; disabled by default in production builds.
 * Set VITE_NDEA_NODE_EDITOR explicitly to override either default.
 */
export const NODE_EDITOR_ENABLED = resolveNodeEditorEnabled(import.meta.env.DEV, import.meta.env.VITE_NDEA_NODE_EDITOR);
