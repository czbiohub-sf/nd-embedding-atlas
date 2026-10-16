import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { Store } from "@tanstack/store";
import type { Metadata, TrajectoryData } from "@/types";

// ── State: what the dataset session knows ──────────────────────────────────

export interface DatasetSessionState {
  metadata: Metadata;
  trajectories: Record<string, TrajectoryData | null>;
}

// ── Actions: what users can do ─────────────────────────────────────────────

export interface DatasetSessionActions {
  refreshMetadata: () => Promise<void>;
  setTrajectory: (data: TrajectoryData | null) => void;
  setTrajectoryTIndex: (key: string, t: number) => void;
  clearTrajectory: (key: string) => void;
}

// ── Runtime: shared refs and infrastructure (not serializable) ─────────────

export interface DatasetSessionRuntime {
  coordinator: Coordinator;
  brushSelection: Selection;
  table: string;
}

// ── Detached-root bridge ───────────────────────────────────────────────────

export interface DatasetSessionValue {
  state: DatasetSessionState;
  actions: DatasetSessionActions;
  runtime: DatasetSessionRuntime;
}

export const datasetSessionStore = new Store<DatasetSessionValue | null>(null);

export function publishDatasetSession(value: DatasetSessionValue): void {
  datasetSessionStore.setState(() => value);
}

export function clearDatasetSession(value: DatasetSessionValue): void {
  datasetSessionStore.setState((current) => (current === value ? null : current));
}
