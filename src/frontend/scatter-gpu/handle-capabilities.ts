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
    clearSelection(): void;
    setForcedSelectionMode(mode: "pan" | "marquee" | "lasso"): void;
}

export interface IsolationCapability {
    setCategoryIsolation(isolatedSet: Set<number>, categoryIndices: Uint8Array): void;
    clearCategoryIsolation(): void;
    setTrajectoryIsolation(rowIndices: number[]): void;
    clearTrajectoryIsolation(): void;
    setContinuousIsolation(rowIndices: number[]): void;
    clearContinuousIsolation(): void;
    rehydrateIsolation(): void;
    setHighlightPoints(rowIndices: number[]): void;
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
}

export interface ColorCapability {
    setColors(
        palette: readonly (readonly [number, number, number, number?])[],
        indices?: Uint8Array,
    ): void;
    setColorsDirect(rgba: Uint8Array): void;
}

/**
 * Full React-layer scatter GPU handle, assembled from capabilities.
 * Replaces the hand-written interface in ScatterGPUHost.tsx.
 */
export type ScatterGPUHostHandle = ColorCapability &
    SelectionCapability &
    IsolationCapability &
    ViewCapability &
    RenderCapability;
