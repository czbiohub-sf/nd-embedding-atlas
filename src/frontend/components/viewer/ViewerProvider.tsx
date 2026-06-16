import {
  Color,
  Idetik,
  type Layer,
  type LayerState,
  OrthographicCamera,
  PanZoomControls,
  PerspectiveCamera,
  type Viewport,
} from "@idetik/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearViewerChannels, publishViewerChannels } from "../../stores/ViewerChannelsStore";
import { clearViewerZ, publishViewerZ } from "../../stores/ViewerZStore";
import type { MultiChannelLayers } from "./MultiChannelLayers";
import { OrbitControls } from "./OrbitControls";
import {
  type ChannelDef,
  type DimensionBounds,
  type TrackedLayer,
  ViewerContext,
  type ViewerInternalContext,
  type ViewerState,
  type ViewMode,
} from "./ViewerContext";

interface Props {
  children: ReactNode;
  channelInstance?: string;
}

function computeAggregate(layers: TrackedLayer[]): LayerState | null {
  if (layers.length === 0) return null;
  if (layers.some((l) => l.state === "loading")) return "loading";
  if (layers.every((l) => l.state === "ready")) return "ready";
  return "loading"; // includes "initialized" state (not yet loading)
}

// ── Runtime factory ─────────────────────────────────────────────────────────

interface RuntimeResult {
  runtime: Idetik;
  viewport: Viewport;
  orthoCamera: OrthographicCamera | null;
  perspectiveCamera: PerspectiveCamera | null;
}

function createRuntime(canvas: HTMLCanvasElement, mode: ViewMode): RuntimeResult {
  if (mode === "3d") {
    const camera = new PerspectiveCamera({ fov: 45 });
    const controls = new OrbitControls(camera, { radius: 500 });
    const runtime = new Idetik({
      canvas,
      viewports: [{ camera, layers: [], cameraControls: controls }],
    });
    return {
      runtime,
      viewport: runtime.viewports[0],
      orthoCamera: null,
      perspectiveCamera: camera,
    };
  }

  const camera = new OrthographicCamera(0, 1, 0, 1);
  const controls = new PanZoomControls(camera);
  const runtime = new Idetik({
    canvas,
    viewports: [{ camera, layers: [], cameraControls: controls }],
  });
  return {
    runtime,
    viewport: runtime.viewports[0],
    orthoCamera: camera,
    perspectiveCamera: null,
  };
}

// ── Provider ────────────────────────────────────────────────────────────────

export function ViewerProvider({ children, channelInstance = "docked" }: Props) {
  // ── Mutable refs ──────────────────────────────────────────────────────
  const runtimeRef = useRef<Idetik | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const cameraRef = useRef<OrthographicCamera | null>(null);
  const perspCameraRef = useRef<PerspectiveCamera | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const layerMapRef = useRef(new Map());

  // ── Reactive state ────────────────────────────────────────────────────
  const [trackedLayers, setTrackedLayers] = useState<TrackedLayer[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [zIndex, setZIndex] = useState(0);
  const [tIndex, setTIndex] = useState(0);
  const [bounds, setBounds] = useState<DimensionBounds>({
    zMax: null,
    tMax: null,
    translation: null,
    scale: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannelsState] = useState<ChannelDef[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [zRange, setZRange] = useState<[number, number] | null>(null);
  const [generation, setGeneration] = useState(0);
  const multiChannelRef = useRef<MultiChannelLayers | null>(null);

  const aggregateState = useMemo(() => computeAggregate(trackedLayers), [trackedLayers]);

  // ── Shared teardown helper ────────────────────────────────────────────
  const teardownRuntime = useCallback(() => {
    // Remove layer callbacks
    for (const [, entry] of layerMapRef.current) {
      entry.layer.removeStateChangeCallback(entry.callback);
    }
    layerMapRef.current.clear();

    if (runtimeRef.current) {
      runtimeRef.current.stop();
      runtimeRef.current = null;
      runningRef.current = false;
    }
    viewportRef.current = null;
    cameraRef.current = null;
    perspCameraRef.current = null;
  }, []);

  const applyRuntime = useCallback((result: RuntimeResult) => {
    runtimeRef.current = result.runtime;
    viewportRef.current = result.viewport;
    cameraRef.current = result.orthoCamera;
    perspCameraRef.current = result.perspectiveCamera;
  }, []);

  // ── Canvas ref callback ───────────────────────────────────────────────
  // Only handles mount/unmount. Mode changes are handled by the effect below.
  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasElRef.current = canvas;
      if (canvas && !runtimeRef.current) {
        applyRuntime(createRuntime(canvas, viewMode));
        console.log("[viewer] initialized=true (canvas mounted)", performance.now().toFixed(1));
        setInitialized(true);
      } else if (!canvas) {
        teardownRuntime();
        setTrackedLayers([]);
        setInitialized(false);
        setError(null);
      }
    },
    // viewMode intentionally excluded — the effect handles mode switches
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyRuntime, teardownRuntime, viewMode],
  );

  // ── Effect: recreate runtime when viewMode changes ────────────────────
  // Viewport.camera is readonly, so switching 2D↔3D requires a new Idetik instance.
  const prevModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevModeRef.current === viewMode) return;
    prevModeRef.current = viewMode;

    const canvas = canvasElRef.current;
    if (!canvas) return;

    const wasRunning = runningRef.current;
    teardownRuntime();
    setTrackedLayers([]);
    setChannelsState([]);

    const result = createRuntime(canvas, viewMode);
    applyRuntime(result);
    if (wasRunning) {
      result.runtime.start();
      runningRef.current = true;
    }
    console.log("[viewer] initialized=true (mode switch)", performance.now().toFixed(1));
    setInitialized(true);
    // Bump generation so hooks (useFovLoader) detect the runtime swap and reload layers
    setGeneration((g) => g + 1);
  }, [viewMode, teardownRuntime, applyRuntime]);

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
    (entries: { id: string; layer: Layer }[]) => {
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
    cameraRef.current?.setFrame(left, right, bottom, top);
  }, []);

  const runningRef = useRef(false);

  const pause = useCallback(() => {
    if (runtimeRef.current && runningRef.current) {
      runtimeRef.current.stop();
      runningRef.current = false;
    }
  }, []);

  const resume = useCallback(() => {
    if (runtimeRef.current && !runningRef.current) {
      runtimeRef.current.start();
      runningRef.current = true;
    }
  }, []);

  const setChannels = useCallback((defs: ChannelDef[], multiChannel: MultiChannelLayers) => {
    multiChannelRef.current = multiChannel;
    setChannelsState(defs);
  }, []);

  const setChannelProp = useCallback(
    (index: number, update: Partial<Pick<ChannelDef, "visible" | "color" | "contrastLimits" | "blendMode">>) => {
      setChannelsState((prev) => {
        const next = prev.map((ch, i) => (i === index ? { ...ch, ...update } : ch));
        const mc = multiChannelRef.current;
        if (mc) {
          // Sync visibility + contrast to idetik channel props
          mc.setChannelProps(
            next.map((ch) => ({
              visible: ch.visible,
              color: Color.fromRgbHex(`#${ch.color}`),
              contrastLimits:
                ch.contrastLimits[0] < ch.contrastLimits[1]
                  ? ch.contrastLimits
                  : [ch.contrastLimits[0], ch.contrastLimits[0] + 1],
            })),
          );
          // Blend mode only applies to 2D layers (individual ImageLayers)
          if (update.blendMode && mc.layers.length > 1) {
            const layer = mc.layers[index];
            if (layer) {
              layer.blendMode = update.blendMode;
            }
          }
        }
        return next;
      });
    },
    [],
  );

  // ── Context value ─────────────────────────────────────────────────────

  const state = useMemo<ViewerState>(
    () => ({
      initialized,
      layers: trackedLayers,
      aggregateState,
      zIndex,
      tIndex,
      bounds,
      error,
      channels,
      viewMode,
      zRange,
      generation,
    }),
    [initialized, trackedLayers, aggregateState, zIndex, tIndex, bounds, error, channels, viewMode, zRange, generation],
  );

  const actions = useMemo(
    () => ({
      setLayers,
      clearLayers,
      setFrame,
      setZIndex,
      setTIndex,
      setBounds,
      setChannels,
      setChannelProp,
      setViewMode,
      setZRange,
      setError,
      pause,
      resume,
    }),
    [setLayers, clearLayers, setFrame, setChannels, setChannelProp, pause, resume],
  );

  // Meta uses refs — recompute when initialized flips so consumers see the real viewport
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-read refs when initialized/viewMode changes
  const meta = useMemo(
    () => ({
      runtime: runtimeRef.current,
      viewport: viewportRef.current,
      orthoCamera: cameraRef.current,
      perspectiveCamera: perspCameraRef.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialized, viewMode],
  );

  // Publish channels to ViewerChannelsStore so TrackGallery can match the viewer.
  // Uses useEffect (not setState updater) to avoid React concurrent-mode side-effect violations.
  useEffect(() => {
    if (channels.length > 0) {
      publishViewerChannels(channelInstance, channels);
    }
    return () => {
      clearViewerChannels(channelInstance);
    };
  }, [channels, channelInstance]);

  // Publish the live Z plane so the gallery can fall back to it when the obs
  // dataframe has no per-obs `z` column.
  useEffect(() => {
    publishViewerZ(channelInstance, zIndex);
    return () => {
      clearViewerZ(channelInstance);
    };
  }, [zIndex, channelInstance]);

  const value = useMemo<ViewerInternalContext>(
    () => ({ state, actions, meta, _canvasRef: canvasRef }),
    [state, actions, meta, canvasRef],
  );

  return <ViewerContext value={value}>{children}</ViewerContext>;
}
