export type BrowserAmbient = [HTMLElement, NodeListOf<Element>[typeof Symbol.iterator]];

// @ts-expect-error Reusable browser UI must not see Bun globals.
export type BunAmbientMustNotLeak = typeof Bun;
