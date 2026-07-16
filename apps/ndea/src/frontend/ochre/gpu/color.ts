// Thin facade over @typegpu/color — re-exports the GPU color-space utilities
// we care about, under ochre's naming.
//
// @typegpu/color provides proper gamut clipping for OkLab→sRGB (via
// `oklabGamutClipSlot`), which our colormaps benefit from for free.

export {
  linearToSrgb as linearRgbToSrgb,
  srgbToLinear as srgbToLinearRgb,
  rgbToOklab as srgbToOkLab,
  oklabToRgb as okLabToSrgb,
  linearRgbToOklab,
  oklabToLinearRgb,
  oklabGamutClip,
  oklabGamutClipSlot,
  oklabGamutClipAlphaAccess,
  hexToRgb,
  hexToRgba,
  hexToOklab,
  hsvToRgb,
  rgbToHsv,
  rgbToYcbcr,
  rgbToYcbcrMatrix,
} from "@typegpu/color";
