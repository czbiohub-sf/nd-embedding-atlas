export type SdkAmbient = [HTMLElement, GPUDevice];

// @ts-expect-error Portable SDK code must not see Bun globals.
export type BunAmbientMustNotLeak = typeof Bun;
