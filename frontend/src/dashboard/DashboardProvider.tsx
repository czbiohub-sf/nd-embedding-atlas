import { Coordinator, restConnector, Selection } from "@uwdata/mosaic-core";
import { brushPredicateStore } from "../providers/BrushPredicateStore";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useColumnTypes } from "../hooks/useColumnTypes";
import { generateDefaultPanels } from "../lib/chart-spec";
import type { ChartPanelEntry, ChartSpec, Metadata, TrajectoryData } from "../types";
import { DashboardContext, type DashboardState } from "./DashboardContext";
import { scatterKeys } from "../scatter-gpu/hooks/queryKeys";

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

    // ── BrushPredicateStore → brushSelection bridge ────────────────────────
    // Subscribes to the Store and calls brushSelection.update() via
    // requestAnimationFrame, outside React's render cycle and outside any
    // active Mosaic AsyncDispatch cycle.  Components write to the Store
    // (setBrushPredicate); this is the single place that actually updates Mosaic.
    useEffect(() => {
        const sub = brushPredicateStore.subscribe(() => {
            const { source, predicate, version } = brushPredicateStore.state;
            if (version === 0) return; // skip initial state
            requestAnimationFrame(() => {
                brushSelection.update({
                    source,
                    clients: new Set(),
                    value: [],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    predicate: predicate ? ({ toString: () => predicate } as any) : null,
                });
            });
        });
        return () => sub.unsubscribe();
    }, [brushSelection]);

    // Metadata
    const queryClient = useQueryClient();
    const metadataQuery = useQuery<Metadata>({
        queryKey: scatterKeys.metadata(),
        queryFn: () => fetch("/data/metadata.json").then((r) => r.json()),
        staleTime: Infinity,
        gcTime: Infinity,
    });
    const metadata = metadataQuery.data ?? null;

    // UI state
    const [highlightId, setHighlightId] = useState<string | null>(null);

    // Trajectory state — shared between scatter and image viewer
    const [trajectory, setTrajectoryState] = useState<TrajectoryData | null>(null);

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

    const setTrajectory = useCallback((data: TrajectoryData | null) => setTrajectoryState(data), []);
    const setTrajectoryTIndex = useCallback(
        (t: number) => setTrajectoryState((prev) => (prev ? { ...prev, tIndex: t } : null)),
        [],
    );

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
        }),
        [addPanel, removePanel, reorderPanels, refreshMetadata, setTrajectory, setTrajectoryTIndex],
    );

    const meta = useMemo(() => ({ coordinator, brushSelection, table: TABLE }), [coordinator, brushSelection]);

    // Memoize state to prevent unnecessary consumer re-renders
    const state = useMemo<DashboardState | null>(
        () => (metadata ? { metadata, highlightId, panels, trajectory } : null),
        [metadata, highlightId, panels, trajectory],
    );

    const contextValue = useMemo(() => (state ? { state, actions, meta } : null), [state, actions, meta]);

    // Don't render until metadata is ready
    if (!contextValue) {
        return <div className="flex h-full items-center justify-center text-sm text-text-secondary">Loading...</div>;
    }

    return <DashboardContext value={contextValue}>{children}</DashboardContext>;
}
