export interface Srgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export interface OkLab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

export interface OkLch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

export type ColorSpace = "srgb" | "linearRgb" | "oklab" | "oklch";

export class ParseColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseColorError";
  }
}
