import type { TgpuRoot } from "typegpu";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface ScatterData {
    /** Float32Array of interleaved positions: [x0,y0, ...] normalized to [-1,1] */
    positions: Float32Array;
    /** Category index per cell (u8) */
    categoryIndices: Uint8Array;
    /** Category names */
    categoryNames: string[];
    /** Number of cells */
    numCells: number;
    /** Float32Array index → __row_index__ in DuckDB */
    rowIndices: number[];
    /** Name of the embedding used */
    embeddingKey: string;
    /** Number of dimensions (2 or 3) */
    ndim: 2 | 3;

    // v2 extension slots (currently unused; keep fields for protocol stability)
    /** RGBA uint8 per point — enables gradient coloring (4 bytes/pt, backend-mapped) */
    colorValues?: Uint8Array;
    /** relative size per point — enables encoding by expression */
    sizeValues?: Float32Array;
    /** LOD tile viewport */
    viewport?: readonly [xMin: number, xMax: number, yMin: number, yMax: number];
}

export interface EmbeddingInfo {
    key: string;
    maxNdim: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ColorMapper = (
    categoryIndex: number,
    pointIndex: number,
    totalCategories: number,
) => [r: number, g: number, b: number];

export interface InteractionConfig {
    /** Zoom easing speed (0–1). Default: 0.06 */
    lerpSpeed?: number;
    /** Zoom easing snap threshold. Default: 0.0001 */
    lerpEpsilon?: number;
    /** Per-scroll-tick zoom multiplier (>1 = zoom in). Default: 1.01 */
    zoomSensitivity?: number;
    /** Minimum zoom level. Default: 0.1 */
    minZoom?: number;
    /** Maximum zoom level. Default: 500 */
    maxZoom?: number;
    /** Enable pan. Default: true */
    pan?: boolean;
    /** Enable zoom. Default: true */
    zoom?: boolean;
    /** Enable lasso selection (Shift+Cmd/Ctrl+drag). Default: true */
    lasso?: boolean;
    /** Enable marquee rectangle selection (Shift+drag). Default: true */
    marquee?: boolean;
}

export interface ScatterplotHandle {
    resize(width: number, height: number): void;
    destroy(): void;
    /** Update color buffer from palette without GPU re-initialization (categorical coloring). */
    updateColors(palette: readonly (readonly [number, number, number])[], categoryIndices?: Uint8Array): void;
    /** Write pre-computed RGBA uint8 array directly to colorBuffer (continuous coloring). */
    updateColorsDirect(rgba: Uint8Array): void;
    /** Switch point rendering shape at runtime. */
    setPointShape(shape: "disk" | "gaussian"): void;
    /** Current pan/zoom state of the viewport. */
    getViewState(): { panX: number; panY: number; zoom: number };
    /** Convert world coordinates to screen pixel coordinates using the current view transform. */
    worldToScreen(worldX: number, worldY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number };
}

export interface RenderConfig {
    /** Point radius in NDC units. Default: 0.003 */
    pointRadius?: number;
    /** Background clear color [r, g, b, a] in 0–1 range. Default: [0.06, 0.06, 0.1, 1] */
    backgroundColor?: [number, number, number, number];
    /** Selection dim factor (0 = fully dimmed, 1 = no dim). Default: 0.08 */
    selectionDimFactor?: number;
    /** Display gamma for compositing pass. Default: 2.2 */
    gamma?: number;
    /**
     * Color mode for points. Default: "categorical".
     * v2: "continuous" uses colorValues Float32Array for gradient coloring.
     */
    colorMode?: "categorical" | "continuous";
    /**
     * Point shape. Default: "disk" (hard edge + AA).
     * "gaussian": soft exp(-r²) falloff — density blends naturally at overlaps.
     */
    pointShape?: "disk" | "gaussian";
}

export interface ScatterplotConfig {
    render?: RenderConfig;
    interaction?: InteractionConfig;
    /** Custom color mapper. Default: palette-based categorical coloring */
    colorMapper?: ColorMapper;
    /** Color palette (RGB tuples). Used when no colorMapper is provided */
    palette?: readonly (readonly [number, number, number])[];
    callbacks?: {
        onSelectionChange?: (count: number | null, indices?: number[]) => void;
        onViewChange?: (zoom: number) => void;
        onPointClick?: (index: number, position: [number, number], categoryIndex: number, categoryName: string) => void;
        onFps?: (fps: number) => void;
    };
}

// ---------------------------------------------------------------------------
// Re-export TgpuRoot for GPU modules
// ---------------------------------------------------------------------------
export type { TgpuRoot };
