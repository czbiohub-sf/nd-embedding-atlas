import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Coordinator, Selection, socketConnector } from "@uwdata/mosaic-core";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { MetadataSchema } from "@ndea/protocol";
import { wsClient } from "@/lib/ws-client";
import { scatterKeys } from "@/lib/query-keys";
import { focusBus } from "@/core/buses/focus-bus";
import { FilterScopeRegistry } from "@/core/coordination/filter-scope-runtime";
import type { Metadata, TrajectoryData } from "@/types";
import {
  clearDatasetSession,
  DatasetDataPublicationRuntime,
  publishDatasetSession,
  type DatasetSessionState,
} from "./dataset-session";

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

const TABLE = "dataset";

export function DatasetSessionProvider({ children }: Props) {
  // Infrastructure: created once.
  // socketConnector: one long-lived WS to /mosaic, no per-query HTTP handshake.
  // Fallback `/data/query` REST endpoint remains for tests and curl.
  const coordinator = useMemo(() => {
    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const uri = `${wsProto}//${location.host}/mosaic`;
    return new Coordinator(socketConnector({ uri }), {
      // keep cache / consolidate / preagg defaults
      logger: import.meta.env.PROD ? null : console,
    });
  }, []);

  const brushSelection = useMemo(() => Selection.crossfilter(), []);
  const filterScopes = useMemo(() => new FilterScopeRegistry({ coordinator, table: TABLE }), [coordinator]);
  const dataPublication = useMemo(() => new DatasetDataPublicationRuntime(globalThis.fetch), []);

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

  // Process-wide focus. Host-scoped consumers use `host.focus`; session
  // consumers use this mirror without conflating focus with render emphasis.
  const focusedRowIndex = useSelector(focusBus.store, (s) => s);

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
      setFocus: focusBus.set,
      refreshMetadata,
      setTrajectory,
      setTrajectoryTIndex,
      clearTrajectory,
    }),
    [refreshMetadata, setTrajectory, setTrajectoryTIndex, clearTrajectory],
  );

  const runtime = useMemo(
    () => ({ coordinator, brushSelection, filterScopes, dataPublication, table: TABLE }),
    [coordinator, brushSelection, filterScopes, dataPublication],
  );

  useEffect(
    () => () => {
      filterScopes.dispose();
      void dataPublication.dispose();
    },
    [filterScopes, dataPublication],
  );

  // Memoize state to prevent unnecessary consumer re-renders
  const state = useMemo<DatasetSessionState | null>(
    () => (metadata ? { metadata, focusedRowIndex, trajectories } : null),
    [metadata, focusedRowIndex, trajectories],
  );

  const sessionValue = useMemo(() => (state ? { state, actions, runtime } : null), [state, actions, runtime]);
  const [published, setPublished] = useState(false);

  useLayoutEffect(() => {
    if (!sessionValue) return;
    publishDatasetSession(sessionValue);
    setPublished(true);
    return () => clearDatasetSession(sessionValue);
  }, [sessionValue]);

  if (metadataQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-primary text-sm text-muted-foreground">
        <p className="text-red-400">
          Failed to load metadata:{" "}
          {metadataQuery.error instanceof Error ? metadataQuery.error.message : String(metadataQuery.error)}
        </p>
        <button
          className="rounded bg-muted px-3 py-1.5 text-xs hover:bg-surface-tertiary"
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
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading...</div>;
  }

  if (!sessionValue || !published) return null;

  return children;
}
