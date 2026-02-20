import { Idetik, type Layer, type LayerState, OrthographicCamera, PanZoomControls, type Viewport } from "@idetik/core";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import {
    type DimensionBounds,
    type TrackedLayer,
    ViewerContext,
    type ViewerInternalContext,
    type ViewerState,
} from "./ViewerContext";

interface Props {
    children: ReactNode;
}

interface LayerEntry {
    layer: Layer;
    callback: (state: LayerState, prev?: LayerState) => void;
}

function computeAggregate(layers: TrackedLayer[]): LayerState | null {
    if (layers.length === 0) return null;
    // LayerState is "initialized" | "loading" | "ready" — no "error" in idetik
    if (layers.some((l) => l.state === "loading")) return "loading";
    if (layers.every((l) => l.state === "ready")) return "ready";
    return "loading";
}

export function ViewerProvider({ children }: Props) {
    // ── Mutable refs ──────────────────────────────────────────────────────
    const runtimeRef = useRef<Idetik | null>(null);
    const viewportRef = useRef<Viewport | null>(null);
    const layerMapRef = useRef<Map<string, LayerEntry>>(new Map());

    // ── Reactive state ────────────────────────────────────────────────────
    const [trackedLayers, setTrackedLayers] = useState<TrackedLayer[]>([]);
    const [initialized, setInitialized] = useState(false);
    const [zIndex, setZIndex] = useState(0);
    const [tIndex, setTIndex] = useState(0);
    const [bounds, setBounds] = useState<DimensionBounds>({ zMax: null, tMax: null });
    const [error, setError] = useState<string | null>(null);

    const aggregateState = useMemo(() => computeAggregate(trackedLayers), [trackedLayers]);

    // ── Canvas ref callback ───────────────────────────────────────────────
    const canvasRef = useCallback((canvas: HTMLCanvasElement | null) => {
        if (canvas && !runtimeRef.current) {
            const camera = new OrthographicCamera(0, 1, 0, 1);
            const controls = new PanZoomControls(camera);
            const runtime = new Idetik({
                canvas,
                viewports: [{ camera, layers: [], cameraControls: controls }],
            });
            // Don't auto-start the render loop — CropViewer calls resume()
            // when a cell is selected, avoiding GPU contention with the scatter.
            runtimeRef.current = runtime;
            viewportRef.current = runtime.viewports[0] ?? null;
            setInitialized(true);
        } else if (!canvas && runtimeRef.current) {
            runtimeRef.current.stop();
            runtimeRef.current = null;
            viewportRef.current = null;
            layerMapRef.current.clear();
            setTrackedLayers([]);
            setInitialized(false);
            setError(null);
        }
    }, []);

    // ── Helpers ───────────────────────────────────────────────────────────

    const removeAllLayers = useCallback(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        for (const [, entry] of layerMapRef.current) {
            entry.layer.removeStateChangeCallback(entry.callback);
            viewport.layerManager.remove(entry.layer);
        }
        layerMapRef.current.clear();
    }, []);

    // ── Actions ───────────────────────────────────────────────────────────

    const setLayers = useCallback(
        (entries: Array<{ id: string; layer: Layer }>) => {
            const viewport = viewportRef.current;
            if (!viewport) return;

            removeAllLayers();
            setError(null);

            const tracked: TrackedLayer[] = [];

            for (const { id, layer } of entries) {
                const cb = (newState: LayerState) => {
                    setTrackedLayers((prev) => prev.map((t) => (t.id === id ? { ...t, state: newState } : t)));
                };
                layer.addStateChangeCallback(cb);
                viewport.layerManager.add(layer);
                layerMapRef.current.set(id, { layer, callback: cb });
                tracked.push({ id, layer, state: layer.state });
            }

            setTrackedLayers(tracked);
        },
        [removeAllLayers],
    );

    const clearLayers = useCallback(() => {
        removeAllLayers();
        setTrackedLayers([]);
        setError(null);
    }, [removeAllLayers]);

    const setFrame = useCallback((left: number, right: number, bottom: number, top: number) => {
        const camera = viewportRef.current?.camera;
        if (camera && "setFrame" in camera) {
            (camera as OrthographicCamera).setFrame(left, right, bottom, top);
        }
    }, []);

    const pause = useCallback(() => {
        runtimeRef.current?.stop();
    }, []);

    const resume = useCallback(() => {
        runtimeRef.current?.start();
    }, []);

    // ── Context value ─────────────────────────────────────────────────────

    const state = useMemo<ViewerState>(
        () => ({ initialized, layers: trackedLayers, aggregateState, zIndex, tIndex, bounds, error }),
        [initialized, trackedLayers, aggregateState, zIndex, tIndex, bounds, error],
    );

    const actions = useMemo(
        () => ({ setLayers, clearLayers, setFrame, setZIndex, setTIndex, setBounds, pause, resume }),
        [setLayers, clearLayers, setFrame, pause, resume],
    );

    // Meta uses refs — recompute when initialized flips so consumers see the real viewport
    const meta = useMemo(() => ({ runtime: runtimeRef.current, viewport: viewportRef.current }), []);

    const value = useMemo<ViewerInternalContext>(
        () => ({ state, actions, meta, _canvasRef: canvasRef }),
        [state, actions, meta, canvasRef],
    );

    return <ViewerContext value={value}>{children}</ViewerContext>;
}
