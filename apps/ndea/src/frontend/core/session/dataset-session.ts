import type { Coordinator, Selection } from "@uwdata/mosaic-core";
import { ErrorResponseSchema, SelectionPublishResponseSchema } from "@ndea/protocol";
import type { NodeInstanceId, RowIndex, RowSetPublication } from "@ndea/sdk";
import { Store } from "@tanstack/store";
import type { Metadata, TrajectoryData } from "@/types";
import type { FilterScopeRegistry } from "@/core/coordination/filter-scope-runtime";

// ── State: what the dataset session knows ──────────────────────────────────

export interface DatasetSessionState {
  metadata: Metadata;
  focusedRowIndex: RowIndex | null;
  trajectories: Record<string, TrajectoryData | null>;
}

// ── Actions: what users can do ─────────────────────────────────────────────

export interface DatasetSessionActions {
  setFocus: (rowIndex: RowIndex | null) => void;
  refreshMetadata: () => Promise<void>;
  setTrajectory: (data: TrajectoryData | null) => void;
  setTrajectoryTIndex: (key: string, t: number) => void;
  clearTrajectory: (key: string) => void;
}

// ── Runtime: shared refs and infrastructure (not serializable) ─────────────

export interface DatasetSessionRuntime {
  coordinator: Coordinator;
  brushSelection: Selection;
  filterScopes: FilterScopeRegistry;
  dataPublication: DatasetDataPublicationRuntime;
  table: string;
}

export class DatasetDataPublicationRuntime {
  private readonly publications = new Set<NodeInstanceId>();
  private readonly operations = new Map<NodeInstanceId, Promise<void>>();
  private token = 0;
  private readonly fetch: typeof globalThis.fetch;

  constructor(fetch: typeof globalThis.fetch) {
    this.fetch = fetch;
  }

  async publishRowSet(
    instanceId: NodeInstanceId,
    rowIds: readonly RowIndex[],
    signal?: AbortSignal,
  ): Promise<RowSetPublication> {
    return this.enqueue(instanceId, async () => {
      const response = await this.fetch.call(globalThis, `/api/selection/${encodeURIComponent(instanceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_indices: rowIds }),
        signal,
      });
      if (!response.ok) {
        const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
        throw new Error(parsed.success ? parsed.data.error : `selection failed (${response.status})`);
      }
      const { table, count } = SelectionPublishResponseSchema.parse(await response.json());
      const token = ++this.token;
      this.publications.add(instanceId);
      return {
        predicate: `__row_index__ IN (SELECT row_index FROM ${table}) /* tok=${token} */`,
        token,
        count,
        table,
      };
    });
  }

  disposePublishedRowSet(instanceId: NodeInstanceId): Promise<void> {
    return this.enqueue(instanceId, async () => {
      if (!this.publications.has(instanceId)) return;
      const response = await this.fetch.call(globalThis, `/api/selection/${encodeURIComponent(instanceId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`selection disposal failed (${response.status})`);
      this.publications.delete(instanceId);
    });
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.publications].map((instanceId) => this.disposePublishedRowSet(instanceId)));
  }

  private enqueue<T>(instanceId: NodeInstanceId, operation: () => Promise<T>): Promise<T> {
    const result = (this.operations.get(instanceId) ?? Promise.resolve()).catch(() => {}).then(operation);
    const tail = result.then(
      () => {},
      () => {},
    );
    this.operations.set(instanceId, tail);
    void tail.finally(() => {
      if (this.operations.get(instanceId) === tail) this.operations.delete(instanceId);
    });
    return result;
  }
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

// ── Trajectory selectors ───────────────────────────────────────────────────

/** Dataset-scoped lookup: use only in components tied to a specific dataset. */
export function selectTrajectory(
  trajectories: Record<string, TrajectoryData | null>,
  datasetKey: string | undefined,
): TrajectoryData | null {
  return trajectories[datasetKey ?? ""] ?? null;
}

/** Returns the first non-null trajectory: use in cross-dataset components. */
export function selectAnyTrajectory(trajectories: Record<string, TrajectoryData | null>): TrajectoryData | null {
  for (const v of Object.values(trajectories)) {
    if (v != null) return v;
  }
  return null;
}
