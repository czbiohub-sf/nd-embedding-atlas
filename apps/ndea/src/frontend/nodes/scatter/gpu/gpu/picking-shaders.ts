/**
 * Picking shaders: vertex + fragment WGSL for the pick render pass.
 *
 * Mirrors the layout of the main scatter shaders (instanced quads, same
 * per-point attributes), but writes one channel per point identity field
 * to an offscreen rgba32f target with brightness-as-depth so the brightest
 * fragment wins overlapping points. luxar reference:
 * `packages/luxar-viewer/src/rendering/picking/point-picking-material.ts`.
 *
 * Output layout per fragment:
 *   R = pointIndex + 1.0   (0 means "no hit"; we encode +1 to reserve 0)
 *   G = nodeId             (always 0.0 for ndea: single scatter node;
 *                           reserved for multi-panel future use)
 *   B = brightness         (peak-normalized falloff for the 5x5 vote)
 *   A = 1.0
 *   @builtin(frag_depth) = 1.0 - clamp(brightness, 0, 1)
 *
 * Hand-written WGSL (not via TypeGPU's `'use gpu'`) because (a) the pick
 * pipeline uses raw WebGPU for explicit depth + multi-output control and
 * (b) we need the same uniforms / vertex attributes as the main render
 * which TypeGPU would otherwise re-bind in a different group. Keep
 * field offsets in sync with `buffers.ts` (`paramsUniform`, `viewUniform`,
 * `selectionModeUniform`, `filterHideUniform`, `sharpnessUniform`).
 */

/**
 * Bind group 0 layout for the picking pipeline:
 *   binding 0: paramsUniform (vec4f)           : radius, aspect, dimFactor, adaptiveScale
 *   binding 1: viewUniform (vec4f)             : panX, panY, zoom, aspect
 *   binding 2: selectionModeUniform (f32)
 *   binding 3: filterHideUniform (u32)
 *   binding 4: sharpnessUniform (f32)
 *   binding 5: pixelFloorUniform (f32)         : min NDC quad half-extent
 */
export const PICK_VERTEX_WGSL = /* wgsl */ `
struct Params { v: vec4<f32> };
struct View   { v: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> view: View;
@group(0) @binding(2) var<uniform> selMode: f32;
@group(0) @binding(3) var<uniform> filterHide: u32;
@group(0) @binding(4) var<uniform> sharpness: f32;
@group(0) @binding(5) var<uniform> pixelFloor: f32;

struct VsIn {
  @location(0) quadPos:          vec2<f32>,
  @location(1) instancePos:      vec2<f32>,
  @location(2) instanceColor:    u32,   // unused; kept so vertex layout matches the main render
  @location(3) instanceSelected: u32,
  @location(4) instanceVisible:  u32,
  @builtin(instance_index) instanceIndex: u32,
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) sharpness: f32,
  // pointId encoded as f32 (lossless to 2^24 ≈ 16M; ndea typical < 2M).
  @location(2) pointId: f32,
}

fn sharpnessCompensation(s: f32) -> f32 {
  return 1.0 / (1.0 - pow(0.01, 1.0 / max(s, 0.01)));
}

@vertex
fn main(in: VsIn) -> VsOut {
  let radius = params.v.x;
  let aspect = view.v.w;
  let offsetX = view.v.x;
  let offsetY = view.v.y;
  let zoom = view.v.z;
  let adaptiveScale = params.v.w;

  let sel = in.instanceSelected;

  // Mirror the main shader's filter-hide and tier-0 dim handling so picking
  // matches what the user actually sees.
  let hideFiltered = sel == 0u && selMode >= 1.0 && filterHide >= 1u;
  let vis = f32(in.instanceVisible) * select(1.0, 0.0, hideFiltered);
  let dimmable = sel == 0u && selMode >= 1.0;
  let pickVis = vis * select(1.0, 0.0, dimmable);

  let worldX = (in.instancePos.x + offsetX) * zoom;
  let worldY = (in.instancePos.y + offsetY) * zoom;

  let sCompensation = sharpnessCompensation(sharpness);
  // Tighter pick disk: 0.5x the visual size keeps picking precise to the
  // brightest core of overlapping points (luxar uses the same factor).
  let pickScale = 0.5;
  let baseRadius = radius * sqrt(zoom) * adaptiveScale * sCompensation * pickScale;
  // Mirror the visual shader's pixel floor so picking remains reliable
  // when the visual quads have been clamped up. Visibility multiplied
  // afterward so culled points still collapse.
  let zoomedRadius = max(baseRadius, pixelFloor) * pickVis;

  let scaledQuad = vec2<f32>(in.quadPos.x * zoomedRadius, in.quadPos.y * zoomedRadius);

  var out: VsOut;
  out.position = vec4<f32>((worldX + scaledQuad.x) / aspect, worldY + scaledQuad.y, 0.0, 1.0);
  out.uv = in.quadPos;
  out.sharpness = sharpness;
  out.pointId = f32(in.instanceIndex) + 1.0;
  return out;
}
`;

export const PICK_FRAGMENT_WGSL = /* wgsl */ `
struct FsIn {
  @location(0) uv: vec2<f32>,
  @location(1) sharpness: f32,
  @location(2) pointId: f32,
}
struct FsOut {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

@fragment
fn main(in: FsIn) -> FsOut {
  let r = length(in.uv);
  if (r > 1.0) { discard; }
  let falloff = pow(max(1.0 - r, 0.0), in.sharpness);
  if (falloff < 0.01) { discard; }
  var out: FsOut;
  out.color = vec4<f32>(in.pointId, 0.0, falloff, 1.0);
  // Brightness-as-depth: brightest fragment wins. depthCompare: 'less-equal'
  // on the pipeline so ties don't drop.
  out.depth = 1.0 - clamp(falloff, 0.0, 1.0);
  return out;
}
`;
