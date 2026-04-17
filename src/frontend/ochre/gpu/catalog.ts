// GPU-side mirror of the CPU catalog's popular linear colormaps. Each entry is
// a `tgpu.fn` that maps `t: f32` → `vec4f` sRGB color and can be dropped into
// any TypeGPU pipeline. Discrete colormaps are CPU-only for now.

import {
  cividis as cividisCpu,
  coolwarm as coolwarmCpu,
  inferno as infernoCpu,
  magma as magmaCpu,
  plasma as plasmaCpu,
  turbo as turboCpu,
  viridis as viridisCpu,
} from "../colormap";
import { RdBu as rdbuCpu } from "../colormap/catalog/colorbrewer";
import { toGpuOkLab } from "./linear-colormap";

// Sequential
export const viridis = toGpuOkLab({ name: "viridis", stops: viridisCpu.stops });
export const plasma = toGpuOkLab({ name: "plasma", stops: plasmaCpu.stops });
export const magma = toGpuOkLab({ name: "magma", stops: magmaCpu.stops });
export const inferno = toGpuOkLab({ name: "inferno", stops: infernoCpu.stops });
export const cividis = toGpuOkLab({ name: "cividis", stops: cividisCpu.stops });
export const turbo = toGpuOkLab({ name: "turbo", stops: turboCpu.stops });

// Diverging
export const coolwarm = toGpuOkLab({ name: "coolwarm", stops: coolwarmCpu.stops });
export const rdbu = toGpuOkLab({ name: "RdBu", stops: rdbuCpu.stops });
