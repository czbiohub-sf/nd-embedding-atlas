/**
 * RenderSettingsStore — global render-quality knobs shared across all
 * scatter panels. Survives panel re-mount and is wired to each scatter
 * GPU host via a `useEffect` subscription in ScatterView.
 *
 * Currently exposes:
 *   - `sharpness` — per-point falloff exponent; 2.0 reproduces the legacy
 *     soft-halo look, higher values harden the edge while a vertex-shader
 *     compensation factor keeps the visible disk size constant.
 *   - `toneMapping` — AgX (default), ACES, Reinhard, or None.
 *   - `bloomStrength` — additive bloom mix amount (0 = no bloom).
 *   - `bloomThreshold` — HDR luminance threshold for the bloom brightpass.
 *   - `exposure` — global exposure stops applied before tone mapping.
 *
 * Single store keeps the dev-tools panel and scatter panels in sync
 * without per-feature plumbing.
 */

import { Store } from "@tanstack/store";

export const SHARPNESS_MIN = 0.5;
export const SHARPNESS_MAX = 16;
// Flat AA disk by default — sharpness 8 fades over the last 12.5% of the
// radius, reading as a crisp 2D marker. Drag down to 2 for a soft halo.
export const SHARPNESS_DEFAULT = 8.0;

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

export interface RenderSettingsState {
  sharpness: number;
  toneMapping: ToneMapping;
  bloomStrength: number;
  bloomThreshold: number;
  exposure: number;
}

export const renderSettingsStore = new Store<RenderSettingsState>({
  sharpness: SHARPNESS_DEFAULT,
  toneMapping: TONE_MAPPING_DEFAULT,
  bloomStrength: BLOOM_STRENGTH_DEFAULT,
  bloomThreshold: BLOOM_THRESHOLD_DEFAULT,
  exposure: EXPOSURE_DEFAULT,
});

export function setSharpness(sharpness: number): void {
  const clamped = Math.max(SHARPNESS_MIN, Math.min(SHARPNESS_MAX, sharpness));
  renderSettingsStore.setState((s) => ({ ...s, sharpness: clamped }));
}

export function setToneMapping(toneMapping: ToneMapping): void {
  renderSettingsStore.setState((s) => ({ ...s, toneMapping }));
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
