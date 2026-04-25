import { sdDisk } from "@typegpu/sdf";
import { tgpu } from "typegpu";
import * as d from "typegpu/data";
import * as std from "typegpu/std";
import type { ScatterUniforms } from "./buffers";

// Unpack u32 packed RGBA (R|(G<<8)|(B<<16)|(A<<24)) → vec4f [0,1].
// Used by the vertex shader to decode the 4-byte-per-point color buffer.
const unpackColor = tgpu.fn([d.u32], d.vec4f)`
  (packed: u32) -> vec4f {
    return vec4f(
      f32(packed & 0xFFu) / 255.0,
      f32((packed >> 8u) & 0xFFu) / 255.0,
      f32((packed >> 16u) & 0xFFu) / 255.0,
      f32((packed >> 24u) & 0xFFu) / 255.0
    );
  }
`;

/**
 * Visibility-compensation factor for the per-point sharpness control.
 *
 * Falloff is `pow(1 - r, sharpness)`. The "visible" radius (where intensity
 * drops to 1% of the peak) shrinks as sharpness grows. Multiplying the quad
 * size by `1 / (1 - 0.01^(1/s))` keeps the visible disk size constant as
 * the user tunes sharpness — see luxar's `point-shaders.ts:62`.
 */
const sharpnessCompensation = tgpu.fn([d.f32], d.f32)`
  (s: f32) -> f32 {
    return 1.0 / (1.0 - pow(0.01, 1.0 / max(s, 0.01)));
  }
`;

export function createVertexShader(uniforms: ScatterUniforms) {
  const { paramsUniform, viewUniform, selectionModeUniform, filterHideUniform, sharpnessUniform } = uniforms;

  return tgpu
    .vertexFn({
      in: {
        quadPos: d.vec2f,
        instancePos: d.vec2f,
        instanceColor: d.u32, // packed RGBA, unpacked via unpackColor
        instanceSelected: d.u32,
        instanceVisible: d.u32,
      },
      out: {
        position: d.builtin.position,
        color: d.vec4f,
        uv: d.vec2f,
        /** 1.0 when this point is the highlighted (clicked) point, 0.0 otherwise. */
        highlight: d.f32,
        /** Per-point falloff exponent forwarded to the fragment shader. */
        sharpness: d.f32,
      },
    })((input) => {
      "use gpu";
      const params = paramsUniform.$;
      const view = viewUniform.$;
      const selMode = selectionModeUniform.$;
      const radius = params.x;
      const aspect = view.w;
      const offsetX = view.x;
      const offsetY = view.y;
      const zoom = view.z;

      // Four-tier dim: 0 = heavy, 1 = moderate, 2 = full bright, 3 = clicked (outline)
      const sel = input.instanceSelected;

      // Visibility: collapse culled points to degenerate (zero-area) position.
      // Also collapses tier-0 points when filterHide is raised (continuous range slider).
      const filterHide = filterHideUniform.$;
      const hideFiltered = sel === 0 && selMode >= 1 && filterHide >= 1;
      const vis = d.f32(input.instanceVisible) * std.select(1.0, 0.0, hideFiltered);

      const worldX = (input.instancePos.x + offsetX) * zoom;
      const worldY = (input.instancePos.y + offsetY) * zoom;

      const adaptiveScale = params.w;
      const isClicked = sel >= 3 && selMode >= 1;
      // Clicked point gets a 1.6x size boost for the outline ring
      const clickedScale = std.select(1.0, 1.6, isClicked);
      // Sharpness compensation keeps the visible disk size constant as
      // sharpness grows — without it, raising the falloff exponent makes
      // points appear smaller even though `radius` is unchanged.
      const sharpness = sharpnessUniform.$;
      const sharpnessScale = sharpnessCompensation(sharpness);
      const zoomedRadius = radius * std.sqrt(zoom) * vis * adaptiveScale * clickedScale * sharpnessScale;
      const scaledQuad = d.vec2f(input.quadPos.x * zoomedRadius, input.quadPos.y * zoomedRadius);

      const selDimFactor = params.z; // heavy dim (default 0.08)
      const moderateDimFactor = std.clamp(selDimFactor * 4.0, 0.0, 0.6); // ~0.32
      const tierAlpha = std.select(std.select(selDimFactor, moderateDimFactor, sel >= 1), 1.0, sel >= 2);
      const dimFactor = std.mix(1.0, tierAlpha, selMode);

      const rgba = unpackColor(input.instanceColor);
      return {
        position: d.vec4f((worldX + scaledQuad.x) / aspect, worldY + scaledQuad.y, 0, 1),
        color: d.vec4f(rgba.x, rgba.y, rgba.z, rgba.w * dimFactor),
        uv: input.quadPos,
        highlight: std.select(0.0, 1.0, isClicked),
        sharpness: sharpness,
      };
    })
    .$uses({ unpackColor, sharpnessCompensation });
}

export function createFragmentShader() {
  return tgpu.fragmentFn({
    in: { color: d.vec4f, uv: d.vec2f, highlight: d.f32, sharpness: d.f32 },
    out: d.vec4f,
  })((input) => {
    "use gpu";
    // `r` is the normalized radial distance from the quad center, 0 at center
    // and 1 at the disk edge (uv ∈ [-1, 1]).
    const r = std.length(input.uv);
    // Anti-aliased clip at the disk edge — keeps the silhouette crisp without
    // introducing a halo. We use the SDF for crispness because `sharpness`
    // alone does not guarantee a hard edge for low values.
    const dist = sdDisk(input.uv, 1.0);
    const fw = std.max(std.fwidth(dist), 0.01);
    const edgeMask = 1 - std.smoothstep(-fw, fw, dist);

    // Per-point falloff: `pow(1 - r, sharpness)` — luxar's POINT_FRAGMENT_SHADER.
    // sharpness=2 reproduces the existing soft-halo look; sharpness=8 produces
    // a near-hard disk; arbitrarily high sharpness produces a 1-pixel disk
    // (clipped by edgeMask).
    const falloff = std.pow(std.max(1 - r, 0), input.sharpness);

    if (input.highlight > 0.5) {
      // Highlighted point: white outline ring + filled center
      // The quad is 1.6x bigger, so the inner disk sits at r=0.625 (1/1.6)
      const innerRadius = 0.625;
      const innerDist = sdDisk(input.uv, innerRadius);
      const innerAlpha = 1 - std.smoothstep(-fw, fw, innerDist);
      // Ring = outer disk minus inner disk
      const ringAlpha = edgeMask * (1 - innerAlpha);
      // Composite: white ring + colored fill
      const ringColor = d.vec4f(1.0, 1.0, 1.0, ringAlpha * 0.9);
      const fillColor = d.vec4f(
        input.color.x * innerAlpha,
        input.color.y * innerAlpha,
        input.color.z * innerAlpha,
        innerAlpha * input.color.w,
      );
      const rO = fillColor.x + ringColor.x * ringColor.w * (1 - fillColor.w);
      const gO = fillColor.y + ringColor.y * ringColor.w * (1 - fillColor.w);
      const bO = fillColor.z + ringColor.z * ringColor.w * (1 - fillColor.w);
      const aO = fillColor.w + ringColor.w * (1 - fillColor.w);
      if (aO < 0.004) {
        std.discard();
      }
      return d.vec4f(rO, gO, bO, aO);
    }

    const finalAlpha = falloff * edgeMask * input.color.w;
    if (finalAlpha < 0.004) {
      std.discard();
    }
    return d.vec4f(input.color.x * finalAlpha, input.color.y * finalAlpha, input.color.z * finalAlpha, finalAlpha);
  });
}
