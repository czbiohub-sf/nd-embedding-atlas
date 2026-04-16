// Minimal type shim for culori/fn (v4 ships ESM-only without bundled .d.ts)
declare module "culori/fn" {
    export interface OklchColor {
        mode: "oklch";
        l: number;
        c: number;
        h: number;
        alpha?: number;
    }

    export type Color = { mode: string; [key: string]: unknown };
    export type Mode = { mode: string; [key: string]: unknown };

    export const modeOklch: Mode;
    export const modeRgb: Mode;

    export function useMode(mode: Mode): void;
    export function parse(color: string): Color | undefined;
    export function formatHex(color: Color): string;
    export function converter(mode: "oklch"): (color: Color) => OklchColor;
    export function converter(mode: string): (color: Color) => Color;
}
