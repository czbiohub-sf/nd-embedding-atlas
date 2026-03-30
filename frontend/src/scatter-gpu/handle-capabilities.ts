/**
 * GPU handle capability interfaces — composable named surfaces.
 *
 * Adding a new GPU method:
 * 1. Add it to the appropriate capability interface here
 * 2. Compose it into ScatterGPUHostHandle below
 * 3. Implement it once in ScatterGPUHost.useImperativeHandle
 *
 * This eliminates the 3-file duplication that existed before.
 */

import type { ViewState } from "../types";

export interface SelectionCapability {
  setExternalSelection(rowIndices: number[]): void;
  clearExternalSelection(): void;
  setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
}

export interface IsolationCapability {
  setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array): void;
  clearCategoryIsolation(): void;
  setRowIsolation(rowIndices: number[]): void;
  clearRowIsolation(): void;
}

export interface ViewCapability {
  getViewState(): ViewState;
  setViewState(state: ViewState): void;
  worldToScreen(wx: number, wy: number, w: number, h: number): { x: number; y: number };
}

export interface ColorCapability {
  setColors(palette: readonly (readonly [number, number, number])[], indices?: Uint8Array): void;
  setColorsDirect(rgba: Uint8Array): void;
}

/**
 * Full React-layer scatter GPU handle, assembled from capabilities.
 * Replaces the hand-written interface in ScatterGPUHost.tsx.
 */
export type ScatterGPUHostHandle = ColorCapability & SelectionCapability & IsolationCapability & ViewCapability;
