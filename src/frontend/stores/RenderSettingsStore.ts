/**
 * RenderSettingsStore — global render-quality knobs shared across all
 * scatter panels. Survives panel re-mount and is wired to each scatter
 * GPU host via a `useEffect` subscription in ScatterView.
 *
 * Currently exposes:
 *   - `sharpness` — per-point falloff exponent; 2.0 reproduces the legacy
 *     soft-halo look, higher values harden the edge while a vertex-shader
 *     compensation factor keeps the visible disk size constant.
 *
 * Future entries (HDR, bloom, tone mapping) land here too — single store
 * keeps the dev-tools panel and scatter panels in sync without per-feature
 * plumbing.
 */

import { Store } from "@tanstack/store";

export const SHARPNESS_MIN = 0.5;
export const SHARPNESS_MAX = 16;
export const SHARPNESS_DEFAULT = 2.0;

export interface RenderSettingsState {
  sharpness: number;
}

export const renderSettingsStore = new Store({
  sharpness: SHARPNESS_DEFAULT,
});

export function setSharpness(sharpness: number): void {
  const clamped = Math.max(SHARPNESS_MIN, Math.min(SHARPNESS_MAX, sharpness));
  renderSettingsStore.setState((s) => ({ ...s, sharpness: clamped }));
}
