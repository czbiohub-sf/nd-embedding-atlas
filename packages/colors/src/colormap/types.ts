import type { ColorSpace, Srgb } from "../color/types";

export interface ColorStop {
  readonly position: number;
  readonly color: Srgb;
}

export interface ColorMap {
  readonly name: string;
  map(t: number): Srgb;
}

export interface LinearColormap extends ColorMap {
  readonly kind: "linear";
  readonly stops: readonly ColorStop[];
  readonly interpolation: ColorSpace;
}

export interface DiscreteColormap extends ColorMap {
  readonly kind: "discrete";
  readonly colors: readonly Srgb[];
}
