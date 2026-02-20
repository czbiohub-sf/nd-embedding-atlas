import type { Idetik, Layer, LayerState, Viewport } from "@idetik/core";
import { createContext } from "react";

// ── Tracked layer ────────────────────────────────────────────────────────────

export interface TrackedLayer {
    id: string;
    layer: Layer;
    state: LayerState;
}

// ── Dimension bounds ─────────────────────────────────────────────────────────

export interface DimensionBounds {
    /** Max Z index, or null if no Z dimension. */
    zMax: number | null;
    /** Max T index, or null if no T dimension. */
    tMax: number | null;
}

// ── State: reactive ──────────────────────────────────────────────────────────

export interface ViewerState {
    initialized: boolean;
    layers: TrackedLayer[];
    /** Aggregate: error > loading > ready > null. */
    aggregateState: LayerState | null;
    zIndex: number;
    tIndex: number;
    bounds: DimensionBounds;
    error: string | null;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export interface ViewerActions {
    /** Atomically replace all layers. */
    setLayers: (layers: Array<{ id: string; layer: Layer }>) => void;
    /** Remove all layers. */
    clearLayers: () => void;
    /** Set the camera frame (left, right, bottom, top). */
    setFrame: (left: number, right: number, bottom: number, top: number) => void;
    setZIndex: (z: number) => void;
    setTIndex: (t: number) => void;
    setBounds: (bounds: DimensionBounds) => void;
    /** Pause the render loop (frees GPU frame budget for other WebGL canvases). */
    pause: () => void;
    /** Resume the render loop. */
    resume: () => void;
}

// ── Meta: non-serializable refs ──────────────────────────────────────────────

export interface ViewerMeta {
    runtime: Idetik | null;
    viewport: Viewport | null;
}

// ── Context value ────────────────────────────────────────────────────────────

export interface ViewerContextValue {
    state: ViewerState;
    actions: ViewerActions;
    meta: ViewerMeta;
}

/** @internal Canvas ref callback — only consumed by ViewerCanvas. */
export interface ViewerInternalContext extends ViewerContextValue {
    _canvasRef: (canvas: HTMLCanvasElement | null) => void;
}

export const ViewerContext = createContext<ViewerInternalContext | null>(null);
