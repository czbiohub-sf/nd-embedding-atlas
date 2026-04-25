/**
 * HDR + bloom + tone mapping shaders.
 *
 * Inputs:
 *   - HDR scene texture (rgba16float)
 *   - Sampler
 *   - ToneMap config uniform: { exposure, bloomStrength, bloomThreshold, mode }
 *
 * Three fullscreen passes:
 *   1. brightpass — sample HDR, threshold + soft-knee, emit to bloom-mip-0
 *   2. blur       — separable two-tap blur in two passes (horizontal then
 *                   vertical) into a ping-pong texture
 *   3. tonemap    — sample HDR + bloom, exposure adjust, AgX/ACES/Reinhard
 *                   conversion, write to swap chain.
 *
 * AgX implementation derived from the public-domain Filament / Three.js
 * port (Troy Sobotka). Constants embedded as `mat3x3<f32>` in the shader.
 */

/** Tone mapping mode IDs — keep in sync with hdr.ts. */
export const TONEMAP_NONE = 0;
export const TONEMAP_REINHARD = 1;
export const TONEMAP_ACES = 2;
export const TONEMAP_AGX = 3;

/** Fullscreen triangle vertex shader used by every HDR pass. */
export const FULLSCREEN_VERTEX_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vidx: u32) -> VsOut {
  // Three vertices covering the screen: (-1,-1) (3,-1) (-1,3).
  let xs = array<f32, 3>(-1.0, 3.0, -1.0);
  let ys = array<f32, 3>(-1.0, -1.0, 3.0);
  var out: VsOut;
  out.position = vec4<f32>(xs[vidx], ys[vidx], 0.0, 1.0);
  // UV in 0..1 with origin at top-left of the screen quad.
  out.uv = vec2<f32>((xs[vidx] + 1.0) * 0.5, 1.0 - (ys[vidx] + 1.0) * 0.5);
  return out;
}
`;

/**
 * Brightpass: extract HDR pixels above the threshold with a soft knee, used
 * as input to the bloom blur. Output written to bloom mip 0 at half res.
 */
export const BRIGHTPASS_FRAGMENT_WGSL = /* wgsl */ `
struct ToneCfg {
  exposure: f32,
  bloomStrength: f32,
  bloomThreshold: f32,
  mode: u32,
};
@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> cfg: ToneCfg;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(hdrTex, samp, uv).rgb;
  // Luminance (Rec. 709)
  let lum = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  // Soft knee: smooth transition over 0.5 wide window centered on threshold
  let knee = 0.5;
  let soft = clamp((lum - cfg.bloomThreshold + knee) / (2.0 * knee), 0.0, 1.0);
  let weight = soft * soft * (3.0 - 2.0 * soft);
  return vec4<f32>(c * weight, 1.0);
}
`;

/**
 * Separable two-tap Gaussian-ish blur. `direction` selects horizontal (1,0)
 * or vertical (0,1) via the texelOffset uniform. Two passes per mip level.
 */
export const BLUR_FRAGMENT_WGSL = /* wgsl */ `
struct BlurCfg {
  texelOffset: vec2<f32>,
  pad: vec2<f32>,
};
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> cfg: BlurCfg;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // 5-tap Gaussian (1, 2, 3, 2, 1) / 9 along the configured direction.
  // Sample at fractional offsets so bilinear filtering combines pairs of
  // taps for free (Kawase-style). 4 actual texture fetches per pass.
  let off = cfg.texelOffset;
  let w0 = 0.227027;
  let w1 = 0.316216;
  let w2 = 0.070270;
  let s0 = textureSample(srcTex, samp, uv).rgb * w0;
  let s1 = textureSample(srcTex, samp, uv + off * 1.3846153846).rgb * w1;
  let s2 = textureSample(srcTex, samp, uv - off * 1.3846153846).rgb * w1;
  let s3 = textureSample(srcTex, samp, uv + off * 3.2307692308).rgb * w2;
  let s4 = textureSample(srcTex, samp, uv - off * 3.2307692308).rgb * w2;
  return vec4<f32>(s0 + s1 + s2 + s3 + s4, 1.0);
}
`;

/**
 * Final tone-map pass. Samples HDR + bloom, applies exposure, picks tone
 * mapper from `cfg.mode`, encodes sRGB on the way out.
 *
 * AgX implementation: input + output 3×3 matrices and a 7th-order
 * polynomial fit of the sigmoid section. Ported from the public-domain
 * Three.js / Filament implementation by Troy Sobotka.
 */
export const TONEMAP_FRAGMENT_WGSL = /* wgsl */ `
struct ToneCfg {
  exposure: f32,
  bloomStrength: f32,
  bloomThreshold: f32,
  mode: u32,
};
@group(0) @binding(0) var hdrTex: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> cfg: ToneCfg;

const MODE_NONE: u32 = 0u;
const MODE_REINHARD: u32 = 1u;
const MODE_ACES: u32 = 2u;
const MODE_AGX: u32 = 3u;

// AgX input transform — REC.709 → AgX working space
const AGX_IN = mat3x3<f32>(
  0.842479062253094,  0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772,  0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104
);
// AgX output transform — AgX → REC.709 (sRGB primaries)
const AGX_OUT = mat3x3<f32>(
   1.19687900512017,  -0.0980208811401368, -0.0990297440797205,
  -0.0528968517574562, 1.15190312990417,   -0.0989611768448433,
  -0.0529716355144438,-0.0980434501171241,  1.15107367264116
);

fn agx_default_contrast(x: vec3<f32>) -> vec3<f32> {
  // 7-th order polynomial sigmoid fit (Troy Sobotka). Domain assumed [0,1].
  let x2 = x * x;
  let x4 = x2 * x2;
  let x6 = x4 * x2;
  return - 17.86   * x6 * x
         + 78.01   * x6
         - 126.7   * x4 * x
         +  92.06  * x4
         -  28.72  * x2 * x
         +   4.361 * x2
         -   0.1718 * x
         +   0.002857;
}

fn tonemap_agx(c: vec3<f32>) -> vec3<f32> {
  // log2 encoding into [0,1] over a 16.5-stop range: -10 EV .. 6.5 EV
  let logMin = -10.0;
  let logMax = 6.5;
  var v = AGX_IN * max(c, vec3<f32>(0.0));
  v = clamp((log2(max(v, vec3<f32>(1e-10))) - logMin) / (logMax - logMin), vec3<f32>(0.0), vec3<f32>(1.0));
  // Apply default contrast and output transform.
  let contrasted = agx_default_contrast(v);
  let outRgb = AGX_OUT * contrasted;
  // AgX output is in REC.709 linear; we encode sRGB at the end.
  return clamp(outRgb, vec3<f32>(0.0), vec3<f32>(1.0));
}

// Approximate ACES — the popular Krzysztof Narkowicz fit used in UE4.
fn tonemap_aces(c: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let cc = 2.43;
  let dd = 0.59;
  let ee = 0.14;
  return clamp((c * (a * c + b)) / (c * (cc * c + dd) + ee), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn tonemap_reinhard(c: vec3<f32>) -> vec3<f32> {
  return c / (vec3<f32>(1.0) + c);
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let cutoff = vec3<f32>(0.0031308);
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0/2.4)) - 0.055;
  return select(hi, lo, c < cutoff);
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let scene = textureSample(hdrTex, samp, uv).rgb;
  let bloom = textureSample(bloomTex, samp, uv).rgb;
  let combined = scene + bloom * cfg.bloomStrength;
  let exposed = combined * exp2(cfg.exposure);

  var mapped: vec3<f32>;
  if (cfg.mode == MODE_NONE) {
    mapped = clamp(exposed, vec3<f32>(0.0), vec3<f32>(1.0));
  } else if (cfg.mode == MODE_REINHARD) {
    mapped = tonemap_reinhard(exposed);
  } else if (cfg.mode == MODE_ACES) {
    mapped = tonemap_aces(exposed);
  } else {
    // AgX. The polynomial+output transform already give a perceptually-
    // calibrated curve; we still gamma-encode for sRGB display below.
    mapped = tonemap_agx(exposed);
  }

  // Encode for sRGB display. Canvas is 'rgba8unorm' (no implicit gamma).
  let srgb = linear_to_srgb(mapped);
  return vec4<f32>(srgb, 1.0);
}
`;
