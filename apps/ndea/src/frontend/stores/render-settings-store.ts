/**
 * RenderSettingsStore: global render-quality knobs shared across all
 * scatter panels. Survives panel re-mount and is wired to each scatter
 * GPU host via a `useEffect` subscription in ScatterView.
 *
 * Currently exposes:
 *   - `pointOpacity`: per-point alpha multiplier. With additive blending
 *     (Path A) this controls how aggressively overlapping points sum:
 *     1.0 = a single point dominates; 0.3 = need ~3 to saturate.
 *   - `toneMapping`: None (default), Reinhard, ACES, or AgX.
 *   - `exposure`: global exposure stops applied before tone mapping.
 *
 * Single store keeps the dev-tools panel and scatter panels in sync
 * without per-feature plumbing.
 */

import { Store } from "@tanstack/store";

export const POINT_OPACITY_MIN = 0.05;
export const POINT_OPACITY_MAX = 1.0;
export const POINT_OPACITY_DEFAULT = 1.0;

export const EXPOSURE_MIN = -3;
export const EXPOSURE_MAX = 3;
export const EXPOSURE_DEFAULT = 0;

export type ToneMapping = "none" | "reinhard" | "aces" | "agx" | "neutral";
// "neutral" by default: Khronos PBR Neutral tone-map preserves source
// colors exactly below ~0.76 luminance and only rolls off extreme HDR
// overdraw, so categorical palette identity is intact AND dense clusters
// glow toward white without clipping. AgX/ACES/Reinhard/None remain opt-in.
export const TONE_MAPPING_DEFAULT: ToneMapping = "neutral";

export type BlendMode = "additive" | "premultiplied" | "max";
// Premultiplied by default: preserves category-color identity in dense
// regions. Additive (order-independent, sums into HDR) is opt-in via the
// Render tab; trades color identity for clean density visualization.
export const BLEND_MODE_DEFAULT: BlendMode = "premultiplied";

export interface RenderSettingsState {
  pointOpacity: number;
  toneMapping: ToneMapping;
  blendMode: BlendMode;
  exposure: number;
}

export const renderSettingsStore = new Store<RenderSettingsState>({
  pointOpacity: POINT_OPACITY_DEFAULT,
  toneMapping: TONE_MAPPING_DEFAULT,
  blendMode: BLEND_MODE_DEFAULT,
  exposure: EXPOSURE_DEFAULT,
});

export function setPointOpacity(opacity: number): void {
  const clamped = Math.max(POINT_OPACITY_MIN, Math.min(POINT_OPACITY_MAX, opacity));
  renderSettingsStore.setState((s) => ({ ...s, pointOpacity: clamped }));
}

export function setToneMapping(toneMapping: ToneMapping): void {
  renderSettingsStore.setState((s) => ({ ...s, toneMapping }));
}

export function setBlendMode(blendMode: BlendMode): void {
  renderSettingsStore.setState((s) => ({ ...s, blendMode }));
}

export function setExposure(exposure: number): void {
  const clamped = Math.max(EXPOSURE_MIN, Math.min(EXPOSURE_MAX, exposure));
  renderSettingsStore.setState((s) => ({ ...s, exposure: clamped }));
}
