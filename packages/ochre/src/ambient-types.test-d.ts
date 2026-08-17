export type ESNextAmbient = Promise<unknown>;

// @ts-expect-error Portable color code must not see Bun globals.
export type BunAmbientMustNotLeak = typeof Bun;

// @ts-expect-error Portable color code must not see DOM globals.
export type DomAmbientMustNotLeak = typeof document;
