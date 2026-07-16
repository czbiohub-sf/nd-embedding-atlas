/**
 * Tests for compositeChannels — the crop compositor.
 *
 * Each blend mode must match idetik's 2D path: per-channel fragment
 * `vec4(value × Color, 1)` composited via glBlendFunc over a black framebuffer,
 * clamped to [0,1] after each layer. See src/server/image.ts.
 */

import { describe, expect, test } from "bun:test";
import { compositeChannels, type ChannelRequest } from "../image.ts";

const WHITE = "FFFFFF";
const RED = "FF0000";
const GREEN = "00FF00";

/** Composite 1×1 channels and return the [r,g,b] bytes of the single pixel. */
function pixel(channels: { slab: number; ch: Partial<ChannelRequest> }[]): [number, number, number] {
  const slabs = channels.map((c) => Float32Array.of(c.slab));
  const reqs: ChannelRequest[] = channels.map((c, i) => ({
    cIndex: i,
    visible: true,
    lo: 0,
    hi: 1,
    color: WHITE,
    ...c.ch,
  }));
  const out = compositeChannels(slabs, reqs, 1, 1, 1, 1);
  return [out[0], out[1], out[2]];
}

describe("compositeChannels blend modes", () => {
  test("additive: value×color summed over black", () => {
    // v=0.5, white → 0.5 → round(0.5*255)=128
    expect(pixel([{ slab: 0.5, ch: { blend: "additive" } }])).toEqual([128, 128, 128]);
  });

  test("additive clamps to [0,1] (two saturated red layers)", () => {
    expect(
      pixel([
        { slab: 1, ch: { blend: "additive", color: RED } },
        { slab: 1, ch: { blend: "additive", color: RED } },
      ]),
    ).toEqual([255, 0, 0]);
  });

  test("blend defaults to additive when omitted", () => {
    expect(pixel([{ slab: 1, ch: { color: RED } }])).toEqual([255, 0, 0]);
  });

  test("normal replaces what's below it", () => {
    // green additive, then red normal → red only (α=1 ⇒ src replaces dst)
    expect(
      pixel([
        { slab: 1, ch: { blend: "additive", color: GREEN } },
        { slab: 1, ch: { blend: "normal", color: RED } },
      ]),
    ).toEqual([255, 0, 0]);
  });

  test("multiply: src × dst", () => {
    // white base [1,1,1], then red multiply [1,0,0] → [1,0,0]
    expect(
      pixel([
        { slab: 1, ch: { blend: "additive", color: WHITE } },
        { slab: 1, ch: { blend: "multiply", color: RED } },
      ]),
    ).toEqual([255, 0, 0]);
  });

  test("subtractive: dst × (1 − src)", () => {
    // white base [1,1,1], then white subtractive src=[1,1,1] → [0,0,0]
    expect(
      pixel([
        { slab: 1, ch: { blend: "additive", color: WHITE } },
        { slab: 1, ch: { blend: "subtractive", color: WHITE } },
      ]),
    ).toEqual([0, 0, 0]);
  });

  test("invisible channels are skipped", () => {
    expect(
      pixel([
        { slab: 1, ch: { blend: "additive", color: RED, visible: false } },
        { slab: 0.5, ch: { blend: "additive", color: WHITE } },
      ]),
    ).toEqual([128, 128, 128]);
  });

  test("contrast window maps lo→0, hi→255", () => {
    // value 60 windowed to [50,70] → (60-50)/20 = 0.5 → 128
    expect(pixel([{ slab: 60, ch: { blend: "additive", lo: 50, hi: 70 } }])).toEqual([128, 128, 128]);
  });

  test("degenerate window (hi==lo) saturates like idetik (1/0 → ∞), not black", () => {
    // mCherry-style unset window: lo=hi=0. idetik's ValueScale = 1/0 = ∞ ⇒ any
    // nonzero pixel saturates. Magenta (FF00FF): R,B saturate to 255, the zero
    // green component is 0×∞ = NaN ⇒ stored as 0. Must NOT be all-black.
    expect(pixel([{ slab: 5, ch: { blend: "additive", lo: 0, hi: 0, color: "FF00FF" } }])).toEqual([255, 0, 255]);
  });
});
