/**
 * GPU handle capability interfaces: composable named surfaces.
 *
 * Adding a new GPU method:
 * 1. Add it to the appropriate capability interface here
 * 2. Compose it into ScatterGPUHostHandle below
 * 3. Implement it once in ScatterGPUHost.useImperativeHandle
 *
 * This eliminates the 3-file duplication that existed before.
 */

import type { ViewState } from "../contracts";
import type { RowIndex } from "@ndea/sdk";

export interface SelectionCapability {
  setExternalSelection(rowIndices: RowIndex[]): void;
  clearExternalSelection(): void;
  clearSelection(): void;
  setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
}

export interface FilterCapability {
  setPredicateFilter(rowIndices: RowIndex[]): void;
  clearPredicateFilter(): void;
}

export interface IsolationCapability {
  setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array): void;
  clearCategoryIsolation(): void;
  setCategoryDisabled(disabledSet: Set<number>, categoryIndices: Uint8Array): void;
  clearCategoryDisabled(): void;
  setTrajectoryIsolation(rowIndices: RowIndex[]): void;
  clearTrajectoryIsolation(): void;
  setContinuousIsolation(rowIndices: RowIndex[]): void;
  clearContinuousIsolation(): void;
  rehydrateIsolation(): void;
  setHighlightPoints(rowIndices: RowIndex[]): void;
  clearHighlight(): void;
}

export interface ViewCapability {
  getViewState(): ViewState;
  setViewState(state: ViewState): void;
  animateToViewState(state: ViewState, durationMs?: number): void;
  worldToScreen(wx: number, wy: number, w: number, h: number): { x: number; y: number };
}

export interface RenderCapability {
  setPointRadius(radius: number): void;
  /**
   * Update per-point alpha multiplier (default 0.7). Drives how
   * aggressively overlapping points sum under additive blending.
   */
  setPointOpacity(opacity: number): void;
  /** Update HDR settings (tone mapping, exposure). */
  setHdrSettings(settings: { toneMapping?: "none" | "reinhard" | "aces" | "agx" | "neutral"; exposure?: number }): void;
  /** Switch scatter blend mode (additive / premultiplied / max). */
  setBlendMode(mode: "additive" | "premultiplied" | "max"): void;
}

export interface ColorCapability {
  setColors(palette: readonly (readonly [number, number, number, number?])[], indices?: Uint8Array): void;
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
  setContinuousLut(lut: Uint32Array): void;
}

/**
 * Full React-layer scatter GPU handle, assembled from capabilities.
 * Replaces the hand-written interface in ScatterGPUHost.tsx.
 */
export type ScatterGPUHostHandle = ColorCapability &
  SelectionCapability &
  FilterCapability &
  IsolationCapability &
  ViewCapability &
  RenderCapability;
