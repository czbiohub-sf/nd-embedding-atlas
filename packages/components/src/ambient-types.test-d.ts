export type ComponentsAmbient = [HTMLElement, NodeListOf<Element>[typeof Symbol.iterator], GPUDevice];

// @ts-expect-error Portable component production code must not see Bun globals.
export type BunAmbientMustNotLeak = typeof Bun;
