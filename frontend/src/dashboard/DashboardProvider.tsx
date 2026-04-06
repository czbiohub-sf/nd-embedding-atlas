import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coordinator, restConnector, Selection } from "@uwdata/mosaic-core";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useColumnTypes } from "../hooks/useColumnTypes";
import { generateDefaultPanels } from "../lib/chart-spec";
import { stringPredicate } from "../lib/mosaic-helpers";
import { MetadataSchema } from "../lib/schemas";
import { scatterKeys } from "../scatter-gpu/hooks/queryKeys";
import { activeFilterStore, clearObsSetFilter, setObsSetFilter } from "../stores/ActiveFilterStore";
import { obsSetStore } from "../stores/ObsSetStore";
import type { ChartPanelEntry, ChartSpec, Metadata, TrajectoryData } from "../types";
import { DashboardContext, type DashboardState } from "./DashboardContext";

// ── Panel reducer ──────────────────────────────────────────────────────────

type PanelAction =
  | { type: "SET_PANELS"; panels: ChartPanelEntry[] }
  | { type: "ADD_PANEL"; spec: ChartSpec }
  | { type: "REMOVE_PANEL"; id: string }
  | { type: "REORDER_PANELS"; ids: string[] };

function panelReducer(state: ChartPanelEntry[], action: PanelAction): ChartPanelEntry[] {
  switch (action.type) {
    case "SET_PANELS":
      return action.panels;
    case "ADD_PANEL":
      return [...state, { id: crypto.randomUUID(), spec: action.spec }];
    case "REMOVE_PANEL":
      return state.filter((p) => p.id !== action.id);
    case "REORDER_PANELS": {
      const byId = new Map(state.map((p) => [p.id, p]));
      return action.ids.map((id) => byId.get(id)).filter((p): p is ChartPanelEntry => p != null);
    }
    default:
      return state;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

const TABLE = "dataset";

export function DashboardProvider({ children }: Props) {
  // Infrastructure — created once
  const coordinator = useMemo(() => {
    const c = new Coordinator();
    c.databaseConnector(restConnector({ uri: "/data/query" }));
    return c;
  }, []);

  const brushSelection = useMemo(() => Selection.crossfilter(), []);

  // ── ActiveFilterStore → brushSelection bridge ─────────────────────────
  // Subscribes to the Store and calls brushSelection.update() via
  // requestAnimationFrame, outside React's render cycle and outside any
  // active Mosaic AsyncDispatch cycle.  Components write to the Store
  // (setActiveFilter / clearActiveFilter); this is the single place that
  // actually updates Mosaic's brushSelection.
  useEffect(() => {
    const sub = activeFilterStore.subscribe(() => {
      const { source, predicate, version } = activeFilterStore.state;
      if (version === 0) return; // skip initial state
      requestAnimationFrame(() => {
        brushSelection.update({
          source,
          clients: new Set(),
          value: predicate ? [predicate] : [],
          predicate: predicate ? stringPredicate(predicate) : null,
        });
      });
    });
    return () => sub.unsubscribe();
  }, [brushSelection]);

  // ── obsSetStore → activeFilterStore bridge ────────────────────────────────
  // Subscribes to obsSetStore; on activation fetches the SQL predicate from the
  // backend and applies it via setObsSetFilter. Uses AbortController to cancel
  // in-flight requests when the active obsset changes before the response arrives.
  // TanStack Store subscribe() fires on setState only — no initial-mount guard needed.
  useEffect(() => {
    const abortRef = { current: new AbortController() };

    const sub = obsSetStore.subscribe(() => {
      abortRef.current.abort();
      abortRef.current = new AbortController();

      const { activeObsSetId } = obsSetStore.state;
      if (!activeObsSetId) {
        clearObsSetFilter();
        return;
      }

      const idAtRequest = activeObsSetId;
      fetch(`/api/obssets/${activeObsSetId}/activate`, {
        method: "POST",
        signal: abortRef.current.signal,
      })
        .then((r) => r.json())
        .then(({ predicate }: { predicate: string }) => {
          if (obsSetStore.state.activeObsSetId === idAtRequest) {
            setObsSetFilter(idAtRequest, predicate);
          }
        })
        .catch(() => {
          // AbortError on unmount or rapid re-activation — ignore
        });
    });

    return () => {
      sub.unsubscribe();
      abortRef.current.abort();
    };
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

  // UI state
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Trajectory state — per-dataset, keyed by datasetKey (empty string for single-dataset mode)
  const [trajectories, setTrajectoriesState] = useState<Record<string, TrajectoryData | null>>({});

  // Panel state
  const [panels, dispatchPanels] = useReducer(panelReducer, []);

  // Column types — used for auto-generating chart panels
  const columnTypes = useColumnTypes(coordinator);

  // Auto-generate default panels once column types are available
  const panelsInitialized = useRef(false);
  useEffect(() => {
    if (!metadata || !columnTypes || panelsInitialized.current) return;
    panelsInitialized.current = true;
    const defaultPanels = generateDefaultPanels(columnTypes, metadata);
    if (defaultPanels.length > 0) {
      dispatchPanels({ type: "SET_PANELS", panels: defaultPanels });
    }
  }, [metadata, columnTypes]);

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

  const addPanel = useCallback((spec: ChartSpec) => dispatchPanels({ type: "ADD_PANEL", spec }), []);
  const removePanel = useCallback((id: string) => dispatchPanels({ type: "REMOVE_PANEL", id }), []);
  const reorderPanels = useCallback((ids: string[]) => dispatchPanels({ type: "REORDER_PANELS", ids }), []);

  // Memoize stable objects (must be before early return to satisfy rules of hooks)
  const actions = useMemo(
    () => ({
      setHighlight: setHighlightId,
      addPanel,
      removePanel,
      reorderPanels,
      refreshMetadata,
      setTrajectory,
      setTrajectoryTIndex,
      clearTrajectory,
    }),
    [addPanel, removePanel, reorderPanels, refreshMetadata, setTrajectory, setTrajectoryTIndex, clearTrajectory],
  );

  const meta = useMemo(() => ({ coordinator, brushSelection, table: TABLE }), [coordinator, brushSelection]);

  // Memoize state to prevent unnecessary consumer re-renders
  const state = useMemo<DashboardState | null>(
    () => (metadata ? { metadata, highlightId, panels, trajectories } : null),
    [metadata, highlightId, panels, trajectories],
  );

  const contextValue = useMemo(() => (state ? { state, actions, meta } : null), [state, actions, meta]);

  if (metadataQuery.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface-primary text-sm text-text-secondary">
        <p className="text-red-400">
          Failed to load metadata:{" "}
          {metadataQuery.error instanceof Error ? metadataQuery.error.message : String(metadataQuery.error)}
        </p>
        <button
          className="rounded bg-surface-secondary px-3 py-1.5 text-xs hover:bg-surface-tertiary"
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
    return <div className="flex h-full items-center justify-center text-sm text-text-secondary">Loading...</div>;
  }

  if (!contextValue) return null;

  return <DashboardContext value={contextValue}>{children}</DashboardContext>;
}
