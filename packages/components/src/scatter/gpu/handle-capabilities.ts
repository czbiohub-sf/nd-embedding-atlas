/**
 * Scatter GPU operations, grouped into named capabilities. `ScatterGPUHostHandle`
 * (the React ref handle) is their composition; the low-level `ScatterplotHandle`
 * (`types.ts`) extends it with lifecycle and host-owned declarative setters, so
 * `ScatterGPUHost` forwards each method by name. A new operation goes in one
 * capability here plus its implementation in `gpu/orchestrator.ts`.
 */

import type { RowIndex, TurntableView, ViewSyncState } from "@ndea/sdk";
import type { DensityMode, SelectionDepth } from "../contracts";

export interface SelectionCapability {
  /** Apply an externally-driven selection (from another panel). */
  setExternalSelection(rowIndices: RowIndex[]): void;
  clearExternalSelection(): void;
  /** Clear lasso/marquee selection. */
  clearSelection(): void;
  /** Switch the drag behaviour: 'pan' = default, 'marquee'/'lasso' = always-draw-selection. */
  setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
  /** 3D: select through (default), or only the nearest dense structure under the shape (2D ignores it). */
  setSelectionDepth(depth: SelectionDepth): void;
}

export interface FilterCapability {
  /** Show only points whose bit is set in the filter-scope predicate bitmask (missing words = 0). */
  setPredicateFilter(bits: Uint32Array): void;
  clearPredicateFilter(): void;
}

export interface IsolationCapability {
  /** Dim points whose category index is not in `isolated` (legend isolation). Empty set clears. */
  setCategoryIsolation(isolated: Set<number>): void;
  clearCategoryIsolation(): void;
  /** Hide disabled categories from drawing, picking, and lasso. Empty set clears. */
  setCategoryDisabled(disabled: Set<number>): void;
  clearCategoryDisabled(): void;
  /** Isolate trajectory points (always visible regardless of category filter). */
  setTrajectoryIsolation(rowIndices: RowIndex[]): void;
  clearTrajectoryIsolation(): void;
  /** Isolate continuous range filter points. */
  setContinuousIsolation(rowIndices: RowIndex[]): void;
  clearContinuousIsolation(): void;
  /** Highlight multiple points (e.g. trajectory points: always full bright). */
  setHighlightPoints(rowIndices: RowIndex[]): void;
  /** Clear the clicked point and the highlight set. */
  clearHighlight(): void;
}

export interface ViewCapability {
  /** Apply a view-sync state (2D cameras skip 3D cells and vice versa). Suppresses the onViewChange broadcast for this write. */
  setViewState(state: ViewSyncState): void;
  /** Animate to a view that frames every point. */
  fitView(): void;
  /** 3D only: perspective or orthographic projection. */
  setProjection(projection: TurntableView["projection"]): void;
  /** Canvas CSS-pixel position of a world point under the current camera; null behind a 3D camera. */
  project(x: number, y: number, z?: number): { x: number; y: number } | null;
}

export interface RenderCapability {
  /** Update point size without GPU re-initialization. */
  setPointRadius(radius: number): void;
  /**
   * Update the per-point alpha multiplier. Default 0.7. Drives how
   * aggressively overlapping points sum under additive blending: at
   * 1.0 a single point dominates, at 0.3 you need ~3 to saturate.
   */
  setPointOpacity(opacity: number): void;
  /** Update HDR settings (tone mapping, exposure). */
  setHdrSettings(settings: { toneMapping?: "none" | "reinhard" | "aces" | "agx" | "neutral"; exposure?: number }): void;
  /** Switch the 2D point blend mode; 3D always draws opaque depth-tested discs. */
  setBlendMode(mode: "additive" | "premultiplied" | "max"): void;
  /** How the density path composites categorical colors (continuous color always averages). */
  setDensityMode(mode: DensityMode): void;
}

export interface ColorCapability {
  /** Categorical coloring: palette by category index (a uniform write; indices re-uploaded when given). */
  setColors(palette: readonly (readonly [number, number, number, number?])[], categoryIndices?: Uint8Array): void;
  /**
   * Continuous coloring: uploads raw values and a 256-entry packed-u32 LUT;
   * colors are computed in the shader. Slider drags and toggles go through
   * the setters below, which are uniform writes.
   */
  setContinuousColors(args: {
    values: Float32Array;
    vmin: number;
    vmax: number;
    lut: Uint32Array;
    reversed: boolean;
    scale?: "linear" | "log" | "sqrt";
  }): void;
  setContinuousRange(vmin: number, vmax: number): void;
  setContinuousReversed(reversed: boolean): void;
  setContinuousScale(scale: "linear" | "log" | "sqrt"): void;
  /** Upload a fresh LUT (colormap change). */
  setContinuousLut(lut: Uint32Array): void;
}

/** React-layer scatter GPU handle (`ScatterGPUHost`'s ref): every capability, no lifecycle. */
export type ScatterGPUHostHandle = ColorCapability &
  SelectionCapability &
  FilterCapability &
  IsolationCapability &
  ViewCapability &
  RenderCapability;
