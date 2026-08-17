export type NodesAmbient = [HTMLElement, NodeListOf<Element>[typeof Symbol.iterator], GPUDevice];

// @ts-expect-error Portable node production code must not see Bun globals.
export type BunAmbientMustNotLeak = typeof Bun;
