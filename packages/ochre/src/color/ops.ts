// Color operations as a tree-shakeable namespace. Import via
// `import { Color } from "@ndea/ochre"` and access ops as `Color.toOkLab`.
//
// sRGB is the canonical CPU color type. `from*` parses / converts *into* sRGB;
// `to*` converts sRGB *to* another space or format.

export {
  srgb as ofSrgb,
  srgbFromHex as fromHex,
  srgbFromU8 as fromU8,
  srgbToU8 as toU8,
  srgbToHex as toHex,
  srgbToCss as toCss,
  srgbFromArray as fromArray,
  srgbToArray as toArray,
} from "./srgb";

export {
  linearRgb as ofLinearRgb,
  srgbToLinearRgb as toLinearRgb,
  linearRgbToSrgb as fromLinearRgb,
  srgbChannelToLinear,
  linearChannelToSrgb,
} from "./linear-rgb";

export { okLab as ofOkLab } from "./oklab";
export { okLch as ofOkLch } from "./oklch";

export {
  srgbToOkLab as toOkLab,
  okLabToSrgb as fromOkLab,
  srgbToOkLch as toOkLch,
  okLchToSrgb as fromOkLch,
} from "./convert";

// Low-level conversions exposed for users who want to skip the sRGB round-trip.
export { linearRgbToOkLab, okLabToLinearRgb } from "./oklab";
export { okLabToOkLch, okLchToOkLab } from "./oklch";
