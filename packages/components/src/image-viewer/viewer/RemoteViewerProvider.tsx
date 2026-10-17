/**
 * `render: "remote"`: a Viewer.Provider whose canvas shows video decoded from
 * the server's headless render page. State mirrors the page's viewer; the
 * controls' actions travel back to it; pointer and wheel input on the canvas
 * replays there. The same CropViewer controls render on top unchanged.
 */

import { Button } from "@ndea/ui/components/button";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImageViewerHost, useImageViewerServices } from "../context";
import { CHUNK_HEADER_BYTES, type RemoteAction, type RemoteViewerState } from "./RenderPageBridge";
import { ViewerContext, type ViewerActions, type ViewerInternalContext, type ViewerState } from "./ViewerContext";

type Status =
  | { phase: "connecting" | "starting" }
  | { phase: "streaming"; fps: number; mbps: number; latency: number | null }
  | { phase: "error"; error: string };

interface InputEvent {
  type: "down" | "move" | "up" | "wheel";
  x: number;
  y: number;
  button?: number;
  buttons?: number;
  dx?: number;
  dy?: number;
  mods?: string[];
}

const INITIAL_STATE: ViewerState = {
  initialized: false,
  layers: [],
  aggregateState: null,
  zIndex: 0,
  tIndex: 0,
  bounds: { zMax: null, tMax: null, translation: null, scale: null },
  error: null,
  channels: [],
  viewMode: "2d",
  zRange: null,
  generation: 0,
  cropSize: 100,
  showBbox: true,
};

const noop = () => {};

/** The optimistic local echo of an action until the page's state acknowledges it. */
function applyAction(state: ViewerState, name: RemoteAction, args: unknown[]): ViewerState {
  if (name === "setChannelProp") {
    const [index, update] = args as [number, Partial<ViewerState["channels"][number]>];
    return {
      ...state,
      channels: state.channels.map((channel, i) => (i === index ? { ...channel, ...update } : channel)),
    };
  }
  const field = {
    setZIndex: "zIndex",
    setTIndex: "tIndex",
    setViewMode: "viewMode",
    setZRange: "zRange",
    setCropSize: "cropSize",
    setShowBbox: "showBbox",
  }[name];
  return { ...state, [field]: args[0] };
}

const modifiers = (event: MouseEvent) =>
  (["alt", "ctrl", "meta", "shift"] as const).filter((mod) => event[`${mod}Key`]);

export function RemoteViewerProvider({
  children,
  channelInstance = "docked",
  onRenderLocal,
}: {
  children: ReactNode;
  channelInstance?: string;
  onRenderLocal: () => void;
}) {
  const { remote, sharedState } = useImageViewerServices();
  const { elementId } = useImageViewerHost();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [state, setState] = useState(INITIAL_STATE);
  const [status, setStatus] = useState<Status>({ phase: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!canvas) return;
    const socket = remote.connect();
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    seqRef.current = 0;
    const send = (message: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const viewport = () => ({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio });

    // ── Decode ──────────────────────────────────────────────────────────
    const context = canvas.getContext("2d")!;
    const stats = { frames: 0, bytes: 0, inputAt: 0, latency: null as number | null };
    let codec = "";
    let decoder: VideoDecoder | null = null;
    let waitingForKey = true;
    const resetDecoder = () => {
      if (decoder && decoder.state !== "closed") decoder.close();
      waitingForKey = true;
      decoder = new VideoDecoder({
        output: (frame) => {
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          context.drawImage(frame, 0, 0);
          frame.close();
          stats.frames++;
          if (stats.inputAt) stats.latency = performance.now() - stats.inputAt;
          stats.inputAt = 0;
        },
        error: (error) => {
          if (error.name === "NotSupportedError") {
            setStatus({ phase: "error", error: `this browser cannot decode ${codec}` });
            return;
          }
          resetDecoder();
          send({ _type: "render/keyframe" });
        },
      });
      decoder.configure({ codec, optimizeForLatency: true });
    };

    socket.onopen = () => send({ _type: "render/start", element: elementId, ...viewport() });
    socket.onclose = () =>
      setStatus((current) => (current.phase === "error" ? current : { phase: "error", error: "disconnected" }));
    socket.onmessage = (event: MessageEvent<string | ArrayBuffer>) => {
      if (typeof event.data !== "string") {
        const chunk = new Uint8Array(event.data);
        stats.bytes += chunk.byteLength;
        const key = (chunk[0] & 1) === 1;
        if (decoder?.state !== "configured" || (waitingForKey && !key)) return;
        waitingForKey = false;
        decoder.decode(
          new EncodedVideoChunk({
            type: key ? "key" : "delta",
            timestamp: Math.round(new DataView(event.data).getFloat64(1, true) * 1000),
            data: chunk.subarray(CHUNK_HEADER_BYTES),
          }),
        );
        return;
      }
      const message = JSON.parse(event.data) as {
        _type: string;
        error?: string;
        codec?: string;
        ack?: number;
        state?: RemoteViewerState;
      };
      switch (message._type) {
        case "render/status":
          return setStatus({ phase: "starting" });
        case "render/config":
          codec = message.codec!;
          return resetDecoder();
        case "render/state":
          // Older than this tile's last edit: the optimistic state is newer.
          if ((message.ack ?? 0) >= seqRef.current) setState({ ...message.state!, layers: [] });
          return;
        case "render/error":
          return setStatus({ phase: "error", error: message.error ?? "remote rendering failed" });
      }
    };

    const statsTimer = setInterval(() => {
      // Read the window's counts now: React runs the updater later, after the reset.
      const streaming = {
        phase: "streaming",
        fps: stats.frames,
        mbps: (stats.bytes * 8) / 1e6,
        latency: stats.latency,
      } as const;
      const started = stats.frames > 0;
      stats.frames = 0;
      stats.bytes = 0;
      setStatus((current) =>
        current.phase === "error" || (current.phase !== "streaming" && !started) ? current : streaming,
      );
    }, 1000);

    // ── Input: coalesce moves and wheel per animation frame ─────────────
    let pendingMove: InputEvent | null = null;
    let pendingWheel: InputEvent | null = null;
    let raf = 0;
    const sendInput = (events: InputEvent[]) => {
      if (events.length === 0) return;
      stats.inputAt ||= performance.now();
      send({ _type: "render/input", events });
    };
    const flush = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      const events = [pendingMove, pendingWheel].filter((event) => event !== null);
      pendingMove = pendingWheel = null;
      sendInput(events);
    };
    const at = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, mods: modifiers(event) };
    };
    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      flush();
      sendInput([{ type: "down", ...at(event), button: event.button, buttons: event.buttons }]);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0) return; // hover drives nothing in the viewer
      pendingMove = { type: "move", ...at(event), buttons: event.buttons };
      raf ||= requestAnimationFrame(flush);
    };
    const onPointerUp = (event: PointerEvent) => {
      flush();
      sendInput([{ type: "up", ...at(event), button: event.button, buttons: event.buttons }]);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      pendingWheel = {
        type: "wheel",
        ...at(event),
        dx: (pendingWheel?.dx ?? 0) + event.deltaX * scale,
        dy: (pendingWheel?.dy ?? 0) + event.deltaY * scale,
      };
      raf ||= requestAnimationFrame(flush);
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);

    // ── Resize: the page re-lays out at the tile's size ─────────────────
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resize = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => send({ _type: "render/resize", ...viewport() }), 100);
    });
    resize.observe(canvas);

    return () => {
      resize.disconnect();
      clearTimeout(resizeTimer);
      clearInterval(statsTimer);
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      socket.onclose = null;
      socket.close();
      socketRef.current = null;
      if (decoder && decoder.state !== "closed") decoder.close();
    };
  }, [canvas, attempt, remote, elementId]);

  const forward = useCallback((name: RemoteAction, args: unknown[]) => {
    seqRef.current++;
    socketRef.current?.send(JSON.stringify({ _type: "render/action", seq: seqRef.current, name, args }));
    setState((current) => applyAction(current, name, args));
  }, []);

  const actions = useMemo<ViewerActions>(
    () => ({
      setZIndex: (z) => forward("setZIndex", [z]),
      setTIndex: (t) => forward("setTIndex", [t]),
      setChannelProp: (index, update) => forward("setChannelProp", [index, update]),
      setViewMode: (mode) => forward("setViewMode", [mode]),
      setZRange: (range) => forward("setZRange", [range]),
      setCropSize: (size) => forward("setCropSize", [size]),
      setShowBbox: (show) => forward("setShowBbox", [show]),
      // Layers, camera, and the render loop live on the page.
      setLayers: noop,
      clearLayers: noop,
      setFrame: noop,
      setBounds: noop,
      setChannels: noop,
      setError: noop,
      pause: noop,
      resume: noop,
    }),
    [forward],
  );

  // Same shared-state publishing as the local provider, so the gallery matches this viewer.
  useEffect(() => {
    if (state.channels.length > 0) sharedState.publishChannels(channelInstance, state.channels);
    return () => sharedState.clearChannels(channelInstance);
  }, [state.channels, channelInstance, sharedState]);
  useEffect(() => {
    sharedState.publishZ(channelInstance, state.zIndex);
    return () => sharedState.clearZ(channelInstance);
  }, [state.zIndex, channelInstance, sharedState]);

  const value = useMemo<ViewerInternalContext>(
    () => ({
      state,
      actions,
      meta: { runtime: null, viewport: null, orthoCamera: null, perspectiveCamera: null },
      _attachCanvas: setCanvas,
    }),
    [state, actions],
  );

  return (
    <ViewerContext value={value}>
      <div className="relative h-full">
        {children}
        <RemoteStatusBadge
          status={status}
          onRetry={() => {
            setStatus({ phase: "connecting" });
            setAttempt((n) => n + 1);
          }}
          onRenderLocal={onRenderLocal}
        />
      </div>
    </ViewerContext>
  );
}

function RemoteStatusBadge({
  status,
  onRetry,
  onRenderLocal,
}: {
  status: Status;
  onRetry: () => void;
  onRenderLocal: () => void;
}) {
  if (status.phase === "error") {
    return (
      <div
        role="alert"
        className="absolute inset-x-0 bottom-12 z-30 mx-auto flex w-fit max-w-[90%] flex-col items-center gap-2 rounded bg-black/75 p-3 text-center text-white/90 text-xs"
      >
        <span className="break-words">Remote rendering failed: {status.error}</span>
        <div className="flex gap-2">
          <Button size="xs" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
          <Button size="xs" variant="secondary" onClick={onRenderLocal}>
            Render locally
          </Button>
        </div>
      </div>
    );
  }
  const text =
    status.phase === "streaming"
      ? `remote · ${status.fps} fps · ${status.mbps.toFixed(1)} Mb/s${status.latency === null ? "" : ` · ${Math.round(status.latency)} ms`}`
      : status.phase === "starting"
        ? "remote · starting renderer…"
        : "remote · connecting…";
  return (
    <div
      data-remote-status={status.phase}
      className="pointer-events-none absolute right-2 bottom-2 z-20 rounded bg-black/60 px-1.5 py-0.5 font-mono text-2xs text-white/85"
    >
      {text}
    </div>
  );
}
