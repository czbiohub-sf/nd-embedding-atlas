import * as d from "typegpu/data";
import * as std from "typegpu/std";
import { sdDisk } from "@typegpu/sdf";
import { vertexFn, fragmentFn } from "./tgpu-compat";
import type { ScatterUniforms } from "./buffers";

export function createVertexShader(uniforms: ScatterUniforms) {
  const { paramsUniform, viewUniform, selectionModeUniform } = uniforms;

  return vertexFn({
    in: {
      quadPos: d.vec2f,
      instancePos: d.vec2f,
      instanceColor: d.vec4f,
      instanceSelected: d.u32,
      instanceVisible: d.u32,
    },
    out: {
      position: d.builtin.position,
      color: d.vec4f,
      uv: d.vec2f,
    },
  })((input) => {
    "use gpu";
    const params = paramsUniform.value;
    const view = viewUniform.value;
    const selMode = selectionModeUniform.value;
    const radius = params.x;
    const aspect = view.w;
    const offsetX = view.x;
    const offsetY = view.y;
    const zoom = view.z;

    // Visibility: collapse culled points to degenerate (zero-area) position
    const vis = d.f32(input.instanceVisible);

    const worldX = (input.instancePos.x + offsetX) * zoom;
    const worldY = (input.instancePos.y + offsetY) * zoom;

    const adaptiveScale = params.w;
    const zoomedRadius = radius * std.sqrt(zoom) * vis * adaptiveScale;
    const scaledQuad = d.vec2f(
      input.quadPos.x * zoomedRadius,
      input.quadPos.y * zoomedRadius,
    );

    const sel = d.f32(input.instanceSelected);
    const selDimFactor = params.z;
    const dimFactor = std.mix(1.0, std.mix(selDimFactor, 1.0, sel), selMode);

    return {
      position: d.vec4f(
        (worldX + scaledQuad.x) / aspect,
        worldY + scaledQuad.y,
        0,
        1,
      ),
      color: d.vec4f(
        input.instanceColor.x * dimFactor,
        input.instanceColor.y * dimFactor,
        input.instanceColor.z * dimFactor,
        input.instanceColor.w,
      ),
      uv: input.quadPos,
    };
  });
}

export function createFragmentShader() {
  return fragmentFn({
    in: { color: d.vec4f, uv: d.vec2f },
    out: d.vec4f,
  })((input) => {
    "use gpu";
    const dist = sdDisk(input.uv, 1.0);
    const fw = std.max(std.fwidth(dist), 0.01);
    const alpha = 1 - std.smoothstep(-fw, fw, dist);
    if (alpha < 0.004) {
      std.discard();
    }
    return d.vec4f(
      input.color.x * alpha,
      input.color.y * alpha,
      input.color.z * alpha,
      alpha,
    );
  });
}
