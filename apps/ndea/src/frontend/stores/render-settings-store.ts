/**
 * RenderSettingsStore: global render-quality knobs shared across all
 * scatter views and handed to each scatter GPU host.
 *
 *   - `pointOpacity`: per-point alpha multiplier. With additive blending
 *     this controls how aggressively overlapping points sum:
 *     1.0 = a single point dominates; 0.3 = need ~3 to saturate.
 *   - `toneMapping`: None, Reinhard, ACES, AgX, or Neutral (default).
 *   - `exposure`: global exposure stops applied before tone mapping.
 */

import { Store } from "@tanstack/store";

const POINT_OPACITY_DEFAULT = 1.0;
const EXPOSURE_DEFAULT = 0;

export type ToneMapping = "none" | "reinhard" | "aces" | "agx" | "neutral";
// "neutral" by default: identity below a 0.95 knee (palette colors render as
// their exact hex), then a hue-preserving shoulder, so dense additive
// overdraw rolls off instead of clipping. AgX/ACES/Reinhard/None remain opt-in.
const TONE_MAPPING_DEFAULT: ToneMapping = "neutral";

export type BlendMode = "additive" | "premultiplied" | "max";
// Premultiplied by default: preserves category-color identity in dense
// regions. Additive (order-independent, sums into HDR) is opt-in via the
// Render tab; trades color identity for clean density visualization.
const BLEND_MODE_DEFAULT: BlendMode = "premultiplied";

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
