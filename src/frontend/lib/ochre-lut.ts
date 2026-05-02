/**
 * Build a 256-entry packed-u32 RGBA LUT from a named ochre colormap.
 *
 * Byte layout per entry (little-endian): R | (G<<8) | (B<<16) | (A<<24).
 * Suitable for direct upload to a TypeGPU `d.arrayOf(d.u32, 256)` buffer.
 */
import { resolveColormap } from "./ochre-palette";

export const LUT_SIZE = 256;

function packSrgb(r: number, g: number, b: number, a: number): number {
  const ri = Math.max(0, Math.min(255, Math.round(r * 255)));
  const gi = Math.max(0, Math.min(255, Math.round(g * 255)));
  const bi = Math.max(0, Math.min(255, Math.round(b * 255)));
  const ai = Math.max(0, Math.min(255, Math.round(a * 255)));
  return (ri | (gi << 8) | (bi << 16) | (ai << 24)) >>> 0;
}

function grayscaleLut(): Uint32Array {
  const out = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    out[i] = packSrgb(t, t, t, 1);
  }
  return out;
}

/**
 * Sample the named colormap at 256 evenly-spaced `t ∈ [0, 1]` values and pack
 * into u32 RGBA. Falls back to grayscale when the name isn't in ochre's catalog.
 *
 * LUT is always built in forward direction (`t = i / (LUT_SIZE - 1)`); the
 * reverse flag is handled by the GPU kernel via a uniform bit so that toggling
 * reversed is a uniform write + re-dispatch, not a CPU LUT regeneration.
 *
 * Ochre's default interpolation space is OkLab for linear colormaps, giving
 * perceptually-uniform gradients even for user-defined two-color palettes.
 */
export function buildColormapLut(name: string): Uint32Array {
  const cmap = resolveColormap(name);
  if (!cmap) return grayscaleLut();

  const out = new Uint32Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = cmap.map(i / (LUT_SIZE - 1));
    out[i] = packSrgb(c.r, c.g, c.b, c.alpha);
  }
  return out;
}
