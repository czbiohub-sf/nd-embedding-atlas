import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Coordinator, restConnector, Selection } from "@uwdata/mosaic-core";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { MetadataSchema } from "@ndea/protocol";
import { wsClient } from "@/lib/ws-client";
import { scatterKeys } from "@/lib/query-keys";
import type { Metadata, TrajectoryData } from "@/types";
import {
  clearDatasetSession,
  datasetSessionStore,
  publishDatasetSession,
  type DatasetSessionState,
} from "./dataset-session";

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

const TABLE = "dataset";

export function DatasetSessionProvider({ children }: Props) {
  // Infrastructure: created once. Mosaic queries POST to same-origin /data/query.
  const coordinator = useMemo(
    () =>
      new Coordinator(restConnector({ uri: `${location.origin}/data/query` }), {
        // keep cache / consolidate / preagg defaults
        logger: process.env.NODE_ENV === "production" ? null : console,
      }),
    [],
  );

  const brushSelection = useMemo(() => Selection.crossfilter(), []);

  // ── WebSocket connection ──────────────────────────────────────────────
  // Opens one persistent /ws connection for the tab. Stays connected for
  // lifetime of the dataset session; reconnects automatically on drop.
  useEffect(() => {
    wsClient.connect();
    return () => wsClient.close();
  }, []);

  // Metadata
  const queryClient = useQueryClient();
  const metadataQuery = useQuery<Metadata>({
    queryKey: scatterKeys.metadata(),
    queryFn: () =>
      fetch("/data/metadata.json")
        .then((r) => r.json())
        .then((d) => MetadataSchema.parse(d)),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const metadata = metadataQuery.data ?? null;

  // Trajectory state: per-dataset, keyed by datasetKey (empty string for single-dataset mode)
  const [trajectories, setTrajectoriesState] = useState<Record<string, TrajectoryData | null>>({});

  // Actions
  const refreshMetadata = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: scatterKeys.metadata() });
  }, [queryClient]);

  const setTrajectory = useCallback((data: TrajectoryData | null) => {
    if (!data) return; // null → no-op; use clearTrajectory(key) instead
    const key = data.datasetKey ?? "";
    setTrajectoriesState((prev) => ({ ...prev, [key]: data }));
  }, []);

  const setTrajectoryTIndex = useCallback((key: string, t: number) => {
    setTrajectoriesState((prev) => {
      const entry = prev[key];
      if (!entry) return prev;
      return { ...prev, [key]: { ...entry, tIndex: t } };
    });
  }, []);

  const clearTrajectory = useCallback((key: string) => {
    setTrajectoriesState((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Memoize stable objects (must be before early return to satisfy rules of hooks)
  const actions = useMemo(
    () => ({
      refreshMetadata,
      setTrajectory,
      setTrajectoryTIndex,
      clearTrajectory,
    }),
    [refreshMetadata, setTrajectory, setTrajectoryTIndex, clearTrajectory],
  );

  const runtime = useMemo(() => ({ coordinator, brushSelection, table: TABLE }), [coordinator, brushSelection]);

  // Memoize state to prevent unnecessary consumer re-renders
  const state = useMemo<DatasetSessionState | null>(
    () => (metadata ? { metadata, trajectories } : null),
    [metadata, trajectories],
  );

  const sessionValue = useMemo(() => (state ? { state, actions, runtime } : null), [state, actions, runtime]);
  // Children read the session from the store, so render them only once it holds a value.
  const published = useSelector(datasetSessionStore, (value) => value !== null);

  useLayoutEffect(() => {
    if (!sessionValue) return;
    publishDatasetSession(sessionValue);
    return () => clearDatasetSession(sessionValue);
  }, [sessionValue]);

  if (metadataQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-primary text-lg text-muted-foreground">
        <p className="text-red-400">
          Failed to load metadata:{" "}
          {metadataQuery.error instanceof Error ? metadataQuery.error.message : String(metadataQuery.error)}
        </p>
        <button
          className="rounded bg-muted px-3 py-1.5 text-ui hover:bg-muted-2"
          onClick={() => {
            void metadataQuery.refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (metadataQuery.isPending) {
    return <div className="flex h-full items-center justify-center text-lg text-muted-foreground">Loading...</div>;
  }

  if (!sessionValue || !published) return null;

  return children;
}
