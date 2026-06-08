import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coordinator, Selection, socketConnector } from "@uwdata/mosaic-core";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useColumnTypes } from "../hooks/useColumnTypes";
import { generateDefaultPanels } from "../lib/chart-spec";
import { stringPredicate } from "../lib/mosaic-helpers";
import { MetadataSchema } from "../../protocol/index.ts";
import { wsClient } from "../lib/ws-client";
import { scatterKeys } from "../scatter-gpu/hooks/queryKeys";
import {
  activeFilterStore,
  clearActiveSetFilter,
  clearLassoFilter,
  composedPredicate,
  setActiveSetFilter,
} from "../stores/ActiveFilterStore";
import { activeCollectionStore } from "../stores/ActiveCollectionStore";
import { broadcastSelection, clearSelectionSync, externalSource } from "../stores/SelectionSyncStore";
import { panelId } from "../lib/branded-types";
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
  // Infrastructure — created once.
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

  // ── WebSocket connection ──────────────────────────────────────────────
  // Opens one persistent /ws connection for the tab. Stays connected for
  // the lifetime of the dashboard; reconnects automatically on drop.
  useEffect(() => {
    wsClient.connect();
    return () => wsClient.close();
  }, []);

  // ── ActiveFilterStore → brushSelection bridge ─────────────────────────
  // Subscribes to the Store and calls brushSelection.update() via
  // requestAnimationFrame, outside React's render cycle and outside any
  // active Mosaic AsyncDispatch cycle. Components write the lasso facet
  // (setLassoFilter) and the active-set facet (setActiveSetFilter); this
  // bridge composes them via AND (composedPredicate) and pushes the result
  // to Mosaic — implicit intersect, no precedence rule.
  useEffect(() => {
    const sub = activeFilterStore.subscribe(() => {
      const state = activeFilterStore.state;
      if (state.version === 0) return; // skip initial state
      const predicate = composedPredicate(state);
      requestAnimationFrame(() => {
        brushSelection.update({
          source: state.source,
          clients: new Set(),
          value: predicate ? [predicate] : [],
          predicate: predicate ? stringPredicate(predicate) : null,
        });
      });
    });
    return () => sub.unsubscribe();
  }, [brushSelection]);

  // ── activeCollectionStore → server /api/active-selection ─────────────
  // Single-active for v1. When activeId flips:
  //   set:   POST /api/active-selection {collection_ids: [id]} → set
  //          ActiveFilterStore.activeSetPredicate; clear lasso (collection
  //          is the new scope; lasso is reset so user can sub-select fresh);
  //          GET row-indices and broadcastSelection(externalSource("collections"))
  //          so the GPU dim mask lights up the members.
  //   clear: DELETE /api/active-selection; clearActiveSetFilter();
  //          clearSelectionSync(externalSource("collections")).
  // AbortController cancels in-flight requests if the user activates a
  // different collection (or deactivates) while one is loading.
  useEffect(() => {
    const abortRef = { current: new AbortController() };
    const COLLECTIONS_SRC = externalSource("collections");
    const BRIDGE_PANEL_ID = panelId("__collections-bridge__");

    const sub = activeCollectionStore.subscribe(() => {
      abortRef.current.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      const { activeId } = activeCollectionStore.state;

      if (!activeId) {
        // Deactivate path: drop server state + filter facet + GPU dim mask.
        clearActiveSetFilter();
        clearSelectionSync(COLLECTIONS_SRC);
        fetch("/api/active-selection", { method: "DELETE", signal }).catch(() => {});
        return;
      }

      const idAtRequest = activeId;

      // 1. Activate clears any existing lasso (per product semantic:
      //    collection is the new working scope; lasso resets so user can
      //    sub-select within the collection without intersecting stale state).
      clearLassoFilter(BRIDGE_PANEL_ID);
      // Clear server-side scatter-selection temp table too, so any Mosaic
      // query that still references __scatter_selection sees zero rows.
      fetch("/api/scatter-selection", { method: "DELETE", signal }).catch(() => {});
      // Notify scatter panels to drop their visual lasso polygon.
      window.dispatchEvent(new CustomEvent("ndea:clear-lasso"));

      // 2. Set the server's active selection. Server creates the
      //    `__active_selection` temp table and returns a predicate that
      //    references it (with an inline tok=... comment for cache busting).
      fetch("/api/active-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_ids: [activeId] }),
        signal,
      })
        .then((r) => r.json())
        .then(async ({ predicate }: { predicate: string; resolved_count: number }) => {
          if (activeCollectionStore.state.activeId !== idAtRequest) return;
          setActiveSetFilter(predicate);

          // 3. Pull the row indices binary so the GPU dim mask can light up
          //    members. Skip the broadcast if the response is empty (the
          //    server may not have populated yet) or if a different
          //    collection was activated in flight (idempotency guard).
          try {
            const r = await fetch("/api/active-selection/row-indices", { signal });
            if (!r.ok) return;
            const buf = await r.arrayBuffer();
            if (activeCollectionStore.state.activeId !== idAtRequest) return;
            const ids = new Uint32Array(buf);
            // Cap at 500k for the GPU dim path. Above that, Mosaic-side
            // filtering still works via predicate; the scatter just won't
            // visually dim non-members. (Real datasets cross this rarely.)
            const HARD_CAP = 500_000;
            if (ids.length === 0 || ids.length > HARD_CAP) return;
            broadcastSelection(COLLECTIONS_SRC, Array.from(ids));
          } catch {
            // Aborted or network error — ignore.
          }
        })
        .catch(() => {
          // Aborted on rapid switch — ignore.
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

  if (!contextValue) return null;

  return <DashboardContext value={contextValue}>{children}</DashboardContext>;
}
