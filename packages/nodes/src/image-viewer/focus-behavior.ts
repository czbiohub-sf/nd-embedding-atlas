import type { RowIndex } from "@ndea/sdk";

export interface ViewerObsSummary {
  fov_name?: string;
  t?: number;
  track_id?: number;
}

export function focusedObservationPath(focusedRowIndex: RowIndex): `/api/obs/${number}` {
  return `/api/obs/${focusedRowIndex}`;
}

export function syncViewerActivity(actions: { pause(): void; resume(): void }, focusedRowIndex: RowIndex | null): void {
  if (focusedRowIndex == null) actions.pause();
  else actions.resume();
}

export function shouldRevealViewer({
  observationReady,
  sourceReady,
  aggregateState,
}: {
  observationReady: boolean;
  sourceReady: boolean;
  aggregateState: "initialized" | "loading" | "ready" | null;
}): boolean {
  return observationReady && sourceReady && aggregateState === "ready";
}

export function formatViewerObsReadout(data: ViewerObsSummary | undefined): string | null {
  if (!data?.fov_name) return null;
  const track = data.track_id != null ? ` · #${data.track_id}` : "";
  const t = data.t != null ? ` · T ${data.t}` : "";
  return `${data.fov_name}${track}${t}`;
}
