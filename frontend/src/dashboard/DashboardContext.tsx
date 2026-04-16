import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { createContext } from "react";
import type { ChartPanelEntry, ChartSpec, Metadata, TrajectoryData } from "../types";

// ── State: what the dashboard knows ────────────────────────────────────────

export interface DashboardState {
    metadata: Metadata;
    highlightId: string | null;
    panels: ChartPanelEntry[];
    trajectories: Record<string, TrajectoryData | null>;
}

// ── Actions: what the dashboard can do ─────────────────────────────────────

export interface DashboardActions {
    setHighlight: (id: string | null) => void;
    addPanel: (spec: ChartSpec) => void;
    removePanel: (id: string) => void;
    reorderPanels: (ids: string[]) => void;
    refreshMetadata: () => Promise<void>;
    setTrajectory: (data: TrajectoryData | null) => void;
    setTrajectoryTIndex: (key: string, t: number) => void;
    clearTrajectory: (key: string) => void;
}

// ── Meta: shared refs and infrastructure (not serializable) ────────────────

export interface DashboardMeta {
    coordinator: Coordinator;
    brushSelection: Selection;
    table: string;
}

// ── Context value ──────────────────────────────────────────────────────────

export interface DashboardContextValue {
    state: DashboardState;
    actions: DashboardActions;
    meta: DashboardMeta;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

// ── Trajectory selectors ───────────────────────────────────────────────────

/** Dataset-scoped lookup — use only in components tied to a specific dataset. */
export function selectTrajectory(
    trajectories: Record<string, TrajectoryData | null>,
    datasetKey: string | undefined,
): TrajectoryData | null {
    return trajectories[datasetKey ?? ""] ?? null;
}

/** Returns the first non-null trajectory — use in cross-dataset components. */
export function selectAnyTrajectory(
    trajectories: Record<string, TrajectoryData | null>,
): TrajectoryData | null {
    for (const v of Object.values(trajectories)) {
        if (v != null) return v;
    }
    return null;
}
