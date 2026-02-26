export interface ObsmEntry {
    prefix: string;
    n_dims: number | null;
    loaded: boolean;
}

export interface Metadata {
    version: string;
    props: {
        data: {
            id: string;
            projection: { x: string; y: string };
        };
    };
    database: { type: string; uri?: string };
    obsm: Record<string, ObsmEntry>;
    obs_columns?: string[];
    export_dir?: string;
    spatial?: {
        fov_col: string | null;
        t_col: string | null;
        bbox_col: string | null;
        x_col: string | null;
        y_col: string | null;
    };
    plate?: boolean;
    plate_pixel_scale?: { x: number; y: number };
    plate_channels?: Array<{
        label: string;
        color: string;
        window: { start: number; end: number; min: number; max: number };
    }>;
}

export interface AxisState {
    obsmKey: string;
    xDim: number;
    yDim: number;
}

// ── Trajectory ────────────────────────────────────────────────────────────

export interface TrajectoryFrame {
    t: number;
    emb_x: number;
    emb_y: number;
    spatial_x: number;
    spatial_y: number;
    category?: number;
}

export interface TrajectoryData {
    trackId: number;
    fovName: string;
    tIndex: number;
    points: TrajectoryFrame[];
}

// ── Chart panel specs ──────────────────────────────────────────────────────

export interface CountPlotSpec {
    type: "count-plot";
    field: string;
    limit?: number;
    order?: "total-descending" | "alphabetical" | "selected-descending";
}

export interface HistogramSpec {
    type: "histogram";
    field: string;
    bins?: number;
    scaleType?: "linear" | "log" | "symlog";
}

export interface ScatterChartSpec {
    type: "scatter";
    xField: string;
    yField: string;
}

export interface BoxPlotSpec {
    type: "boxplot";
    field: string;
    groupField?: string;
}

export type ChartSpec = CountPlotSpec | HistogramSpec | ScatterChartSpec | BoxPlotSpec;

export interface ChartPanelEntry {
    id: string;
    spec: ChartSpec;
    collapsed?: boolean;
}

// ── Cell info (from /api/cell/:id) ───────────────────────────────────────────

export interface CellBbox {
    y_min: number;
    x_min: number;
    y_max: number;
    x_max: number;
}

export interface CellInfo {
    fov_name: string;
    t: number;
    x: number;
    y: number;
    bbox?: CellBbox;
}
