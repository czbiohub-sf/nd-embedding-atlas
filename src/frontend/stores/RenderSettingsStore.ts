/**
 * RenderSettingsStore — global render-quality knobs shared across all
 * scatter panels. Survives panel re-mount and is wired to each scatter
 * GPU host via a `useEffect` subscription in ScatterView.
 *
 * Currently exposes:
 *   - `pointOpacity` — per-point alpha multiplier. With additive blending
 *     (Path A) this controls how aggressively overlapping points sum:
 *     1.0 = a single point dominates; 0.3 = need ~3 to saturate.
 *   - `toneMapping` — AgX (default), ACES, Reinhard, or None.
 *   - `bloomStrength` — additive bloom mix amount (0 = no bloom).
 *   - `bloomThreshold` — HDR luminance threshold for the bloom brightpass.
 *   - `exposure` — global exposure stops applied before tone mapping.
 *
 * Single store keeps the dev-tools panel and scatter panels in sync
 * without per-feature plumbing.
 */

import { Store } from "@tanstack/store";

export const POINT_OPACITY_MIN = 0.05;
export const POINT_OPACITY_MAX = 1.0;
// 0.7 strikes a balance: a single point reads at ~70% intensity, two
// overlapping points sum to ~1.4 (rolled off by AgX), and dense clusters
// glow tone-mapped past 1.0 instead of saturating per-fragment.
export const POINT_OPACITY_DEFAULT = 0.7;

export const BLOOM_STRENGTH_MIN = 0;
export const BLOOM_STRENGTH_MAX = 1.5;
// Subtle bloom on by default — pairs with additive blending + AgX tone
// mapping to roll off >1 HDR overflow in dense clusters. Drag to 0 for a
// pure flat-disk look without halo.
export const BLOOM_STRENGTH_DEFAULT = 0.3;

export const BLOOM_THRESHOLD_MIN = 0;
export const BLOOM_THRESHOLD_MAX = 4;
export const BLOOM_THRESHOLD_DEFAULT = 1.0;

export const EXPOSURE_MIN = -3;
export const EXPOSURE_MAX = 3;
export const EXPOSURE_DEFAULT = 0;

export type ToneMapping = "none" | "reinhard" | "aces" | "agx";
// AgX by default — additive blending overflows past 1.0 in dense clusters
// by design, and AgX's gentle filmic shoulder rolls that overflow off into
// readable color rather than clipping to flat white. Sparse points stay
// linear (the curve is near-identity below 1.0).
export const TONE_MAPPING_DEFAULT: ToneMapping = "agx";

export type BlendMode = "additive" | "premultiplied" | "max";
// Additive by default — order-independent, dense regions sum into HDR
// space and tone-map cleanly. See pipeline.ts:BlendMode for trade-offs.
export const BLEND_MODE_DEFAULT: BlendMode = "additive";

export interface RenderSettingsState {
  pointOpacity: number;
  toneMapping: ToneMapping;
  blendMode: BlendMode;
  bloomStrength: number;
  bloomThreshold: number;
  exposure: number;
}

export const renderSettingsStore = new Store<RenderSettingsState>({
  pointOpacity: POINT_OPACITY_DEFAULT,
  toneMapping: TONE_MAPPING_DEFAULT,
  blendMode: BLEND_MODE_DEFAULT,
  bloomStrength: BLOOM_STRENGTH_DEFAULT,
  bloomThreshold: BLOOM_THRESHOLD_DEFAULT,
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

export function setBloomStrength(bloomStrength: number): void {
  const clamped = Math.max(BLOOM_STRENGTH_MIN, Math.min(BLOOM_STRENGTH_MAX, bloomStrength));
  renderSettingsStore.setState((s) => ({ ...s, bloomStrength: clamped }));
}

export function setBloomThreshold(bloomThreshold: number): void {
  const clamped = Math.max(BLOOM_THRESHOLD_MIN, Math.min(BLOOM_THRESHOLD_MAX, bloomThreshold));
  renderSettingsStore.setState((s) => ({ ...s, bloomThreshold: clamped }));
}

export function setExposure(exposure: number): void {
  const clamped = Math.max(EXPOSURE_MIN, Math.min(EXPOSURE_MAX, exposure));
  renderSettingsStore.setState((s) => ({ ...s, exposure: clamped }));
}
