// Isolate TypeGPU unstable APIs. Update only this file on TypeGPU upgrades.
import tgpu from "typegpu";
export const computeFn = tgpu["~unstable"].computeFn;
export const vertexFn = tgpu["~unstable"].vertexFn;
export const fragmentFn = tgpu["~unstable"].fragmentFn;
