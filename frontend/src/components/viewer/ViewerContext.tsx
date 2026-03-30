import type { Idetik, Layer, LayerState, OrthographicCamera, PerspectiveCamera, Viewport } from "@idetik/core";
import { createContext } from "react";
import type { MultiChannelLayers } from "../../lib/MultiChannelLayers";

// ── Tracked layer ────────────────────────────────────────────────────────────

export interface TrackedLayer {
  id: string;
  layer: Layer;
  state: LayerState;
}

// ── Channel definition ───────────────────────────────────────────────────────

export type BlendMode = "normal" | "additive" | "multiply" | "subtractive";

export interface ChannelDef {
  label: string;
  color: string; // hex like "FF0000"
  visible: boolean;
  contrastLimits: [number, number];
  contrastRange: [number, number]; // full range for slider min/max
  blendMode: BlendMode;
}

// ── View mode ────────────────────────────────────────────────────────────────

export type ViewMode = "2d" | "3d";

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
  /** Aggregate: loading > ready > null. Errors are tracked separately via ``error``. */
  aggregateState: LayerState | null;
  zIndex: number;
  tIndex: number;
  bounds: DimensionBounds;
  error: string | null;
  channels: ChannelDef[];
  viewMode: ViewMode;
  /** Z range for 3D volume rendering [zMin, zMax]. Null in 2D mode. */
  zRange: [number, number] | null;
  /** Increments on runtime recreation (mode switch). Used by hooks to detect layer invalidation. */
  generation: number;
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
  /** Replace channel definitions and store the MultiChannelLayers ref. */
  setChannels: (channels: ChannelDef[], multiChannel: MultiChannelLayers) => void;
  /** Update a single channel property (visible, color, contrastLimits, blendMode). */
  setChannelProp: (
    index: number,
    update: Partial<Pick<ChannelDef, "visible" | "color" | "contrastLimits" | "blendMode">>,
  ) => void;
  setViewMode: (mode: ViewMode) => void;
  setZRange: (range: [number, number]) => void;
  setError: (error: string | null) => void;
  /** Pause the render loop (frees GPU frame budget for other WebGL canvases). */
  pause: () => void;
  /** Resume the render loop. */
  resume: () => void;
}

// ── Meta: non-serializable refs ──────────────────────────────────────────────

export interface ViewerMeta {
  runtime: Idetik | null;
  viewport: Viewport | null;
  orthoCamera: OrthographicCamera | null;
  perspectiveCamera: PerspectiveCamera | null;
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
