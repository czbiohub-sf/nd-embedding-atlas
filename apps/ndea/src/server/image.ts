/** Channel compositor: float slabs → RGBA8 for the crop worker. */

export interface ChannelRequest {
  /** Index into the C axis of the zarr array. */
  cIndex: number;
  /** Whether to include this channel in the composite. */
  visible: boolean;
  /** Low end of the intensity window (mapped to 0). */
  lo: number;
  /** High end of the intensity window (mapped to 255). */
  hi: number;
  /** Hex color without '#', e.g. "FF0000". Applied multiplicatively. */
  color: string;
  /**
   * Compositing mode: "normal" | "additive" | "multiply" | "subtractive"
   * (mirrors the viewer's ChannelDef.blendMode). Defaults to "additive".
   */
  blend?: string;
}

/**
 * Composite `channels` into an RGBA8 buffer.
 *
 * Each channel slab is `srcW × srcH` float32 pixel intensities (one channel's
 * 2D slice). Channels are windowed (`value = (texel - lo)/(hi - lo)`, NOT
 * pre-clamped) and tinted (`value × color`), then blended in array order over a
 * black accumulator, exactly mirroring idetik's 2D path: each channel is one
 * `ImageLayer` whose fragment emits `vec4(value × Color, 1)` and is composited
 * via `glBlendFunc`. The four modes we expose map to:
 *   - normal      (SRC_ALPHA, ONE_MINUS_SRC_ALPHA, α=1) → src replaces dst
 *   - additive    (SRC_ALPHA, ONE,                 α=1) → src + dst
 *   - multiply    (DST_COLOR, ZERO)                     → src × dst
 *   - subtractive (ZERO,      ONE_MINUS_SRC_COLOR)      → dst × (1 − src)
 * The accumulator is clamped to [0,1] after every channel, matching the UNORM
 * framebuffer write between idetik layer draws. Invisible channels are skipped.
 * The alpha byte is always 255. Output is nearest-neighbour resampled to
 * dstW × dstH.
 */
export function compositeChannels(
  slabs: Float32Array[],
  channels: readonly ChannelRequest[],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (slabs.length !== channels.length) {
    throw new Error(`compositeChannels: slabs.length=${slabs.length} != channels.length=${channels.length}`);
  }

  const srcRGB = new Float32Array(srcW * srcH * 3); // black accumulator
  for (let k = 0; k < channels.length; k++) {
    const ch = channels[k];
    if (!ch.visible) continue;
    const [r, g, b] = hexToRgbFloat(ch.color);
    const span = ch.hi - ch.lo;
    // Degenerate window (hi == lo): idetik computes ValueScale = 1/(hi-lo) = ±∞,
    // so every pixel ≠ lo saturates that channel. Replicate that (1/0 → ∞)
    // rather than zeroing it: otherwise an unset/zero-width channel renders
    // black in the crop but fully-on in the viewer (the green-vs-magenta bug).
    // The per-channel clamp below maps the resulting ∞/NaN the way a UNORM
    // store does.
    const invSpan = 1 / span;
    const slab = slabs[k];
    const blend = ch.blend ?? "additive";
    for (let i = 0; i < slab.length; i++) {
      const v = (slab[i] - ch.lo) * invSpan; // unclamped, matches idetik `value`
      const sr = v * r;
      const sg = v * g;
      const sb = v * b;
      const base = i * 3;
      let nr: number;
      let ng: number;
      let nb: number;
      switch (blend) {
        case "normal": // α=1 → src replaces dst
          nr = sr;
          ng = sg;
          nb = sb;
          break;
        case "multiply": // src × dst
          nr = srcRGB[base] * sr;
          ng = srcRGB[base + 1] * sg;
          nb = srcRGB[base + 2] * sb;
          break;
        case "subtractive": // dst × (1 − src)
          nr = srcRGB[base] * (1 - sr);
          ng = srcRGB[base + 1] * (1 - sg);
          nb = srcRGB[base + 2] * (1 - sb);
          break;
        default: // additive: src + dst
          nr = srcRGB[base] + sr;
          ng = srcRGB[base + 1] + sg;
          nb = srcRGB[base + 2] + sb;
      }
      // UNORM framebuffer write clamps to [0,1] after each layer draw; NaN
      // (from 0×∞ on a zero-width window, e.g. a black colour component of a
      // saturated channel) stores as 0, same as a real UNORM write. The
      // `> 0 ? … : 0` form maps NaN/≤0 → 0 and >1 → 1 in one shot.
      srcRGB[base] = nr > 0 ? (nr > 1 ? 1 : nr) : 0;
      srcRGB[base + 1] = ng > 0 ? (ng > 1 ? 1 : ng) : 0;
      srcRGB[base + 2] = nb > 0 ? (nb > 1 ? 1 : nb) : 0;
    }
  }

  const out = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const ySrc = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const xSrc = Math.min(srcW - 1, Math.floor(x * xRatio));
      const srcIdx = (ySrc * srcW + xSrc) * 3;
      const dstIdx = (y * dstW + x) * 4;
      out[dstIdx] = clamp255(srcRGB[srcIdx]);
      out[dstIdx + 1] = clamp255(srcRGB[srcIdx + 1]);
      out[dstIdx + 2] = clamp255(srcRGB[srcIdx + 2]);
      out[dstIdx + 3] = 255;
    }
  }
  return out;
}

function clamp255(v: number): number {
  const n = Math.round(v * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function hexToRgbFloat(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "").padStart(6, "0");
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
