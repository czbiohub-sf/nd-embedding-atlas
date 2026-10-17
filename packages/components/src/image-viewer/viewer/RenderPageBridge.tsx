/**
 * The headless render page's side of remote rendering. Mounted inside the
 * real `Viewer.Provider`, it streams the viewer's canvas over the render
 * socket as WebCodecs chunks, publishes the viewer state the remote tile's
 * controls show, and applies the actions those controls send back. Pointer
 * and wheel input arrives as real mouse events through CDP, not here.
 */

import { useEffect, useRef } from "react";
import { useImageViewerServices } from "../context";
import { useViewer } from "./useViewer";
import type { ViewerActions, ViewerState } from "./ViewerContext";

/** Viewer actions the remote tile's controls may call; everything else stays page-local. */
export const REMOTE_ACTIONS = [
  "setZIndex",
  "setTIndex",
  "setChannelProp",
  "setViewMode",
  "setZRange",
  "setCropSize",
  "setShowBbox",
] as const satisfies readonly (keyof ViewerActions)[];
export type RemoteAction = (typeof REMOTE_ACTIONS)[number];

/** The viewer state the page publishes: everything but live layer objects. */
export type RemoteViewerState = Omit<ViewerState, "layers">;

/** Chunk header: `u8 flags (bit 0: key) · f64 capture time (epoch ms)`. */
export const CHUNK_HEADER_BYTES = 9;

/** Tried in order; the same list `ndea self doctor` probes (`server/chrome.ts` REMOTE_CODECS). */
const CODECS = ["avc1.640033", "vp09.00.41.08"];
/** Page-side socket queue before delta chunks drop (the server applies the same rule toward the viewer). */
const SOCKET_BUFFER_LIMIT = 4 << 20;
/**
 * A realtime encoder spends one frame's bitrate budget on a still scene's frame, so the
 * view stays soft once it stops changing; re-sending the same frame sharpens it each pass.
 * ponytail: fixed passes; per-codec quantizer control (`encode({ avc: { quantizer } })`) if this falls short.
 */
const REFINE_PASSES = 3;
const REFINE_DELAY_MS = 150;

type TrackProcessor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

interface CanvasStream {
  /** Make the next chunk a keyframe; a still scene re-encodes its last frame. */
  keyframe(): void;
  stop(): void;
}

const epochMicros = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

/** Encode what `canvas` composites, at most `fps` times a second, never dropping the newest frame. */
function streamCanvas(
  canvas: HTMLCanvasElement,
  socket: WebSocket,
  { fps, bpp }: { fps: number; bpp: number },
  /** Draws the scene again (idetik renders only on change). */
  redraw: () => void,
): CanvasStream {
  // Chrome exposes the processor on window; the TS DOM lib does not declare it.
  const chromeGlobals = globalThis as unknown as { MediaStreamTrackProcessor: TrackProcessor };
  // No frame rate here: a rate-limited capture skips a draw that comes too soon and, in a
  // scene that then goes still, never delivers it. `pump` paces instead.
  const track = canvas.captureStream().getVideoTracks()[0];
  const reader = new chromeGlobals.MediaStreamTrackProcessor({ track }).readable.getReader();
  let encoder: VideoEncoder | null = null;
  let codec: string | null = null;
  let size = "";
  let forceKey = true;
  /** The newest frame: re-encoded for keyframe requests. */
  let last: VideoFrame | null = null;
  /** `last` has not gone out yet. */
  let stale = false;
  let sentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Re-sends of a still frame so far (see REFINE_PASSES). */
  let refinements = 0;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;

  const fail = (error: unknown) =>
    socket.send(JSON.stringify({ _type: "render/error", error: `encoder: ${String(error)}` }));

  const output = (chunk: EncodedVideoChunk) => {
    const key = chunk.type === "key";
    if (!key && socket.bufferedAmount > SOCKET_BUFFER_LIMIT) {
      forceKey = true;
      return;
    }
    const buffer = new ArrayBuffer(CHUNK_HEADER_BYTES + chunk.byteLength);
    const header = new DataView(buffer);
    header.setUint8(0, key ? 1 : 0);
    header.setFloat64(1, chunk.timestamp / 1000, true);
    chunk.copyTo(new Uint8Array(buffer, CHUNK_HEADER_BYTES));
    socket.send(buffer);
  };

  const configure = async (width: number, height: number) => {
    const config = (candidate: string): VideoEncoderConfig => ({
      codec: candidate,
      width,
      height,
      bitrate: Math.round(width * height * fps * bpp),
      framerate: fps,
      latencyMode: "realtime",
      ...(candidate.startsWith("avc1") ? { avc: { format: "annexb" } } : {}),
    });
    if (!codec) {
      for (const candidate of CODECS) {
        if ((await VideoEncoder.isConfigSupported(config(candidate))).supported) {
          codec = candidate;
          break;
        }
      }
      if (!codec) throw new Error(`no supported encoder among ${CODECS.join(", ")}`);
    }
    if (encoder?.state !== "closed") encoder?.close();
    encoder = new VideoEncoder({ output, error: fail });
    encoder.configure(config(codec));
    encoder.ondequeue = () => pump();
    socket.send(JSON.stringify({ _type: "render/config", codec, width, height }));
    forceKey = true;
  };

  /** Encode `last` once the encoder has room and the frame interval has passed. */
  const pump = () => {
    if (!stale || !last || encoder?.state !== "configured" || encoder.encodeQueueSize > 1) return;
    const wait = sentAt + 1000 / fps - performance.now();
    clearTimeout(timer);
    if (wait > 0) {
      timer = setTimeout(pump, wait);
      return;
    }
    const frame = withOverlays(last);
    encoder.encode(frame, { keyFrame: forceKey });
    frame.close();
    forceKey = false;
    stale = false;
    sentAt = performance.now();
    clearTimeout(refineTimer);
    if (refinements < REFINE_PASSES) {
      refineTimer = setTimeout(() => {
        refinements++;
        stale = true;
        pump();
      }, REFINE_DELAY_MS);
    }
  };

  // HTML overlays (the bbox) sit outside the WebGL canvas: draw them into the frame.
  let composite: OffscreenCanvas | null = null;
  const withOverlays = (frame: VideoFrame): VideoFrame => {
    const timestamp = epochMicros();
    const overlays = [...(canvas.parentElement?.querySelectorAll<HTMLElement>("[data-viewer-overlay]") ?? [])].filter(
      (element) => element.style.display !== "none",
    );
    if (overlays.length === 0) return new VideoFrame(frame, { timestamp });
    const { displayWidth: width, displayHeight: height } = frame;
    if (composite?.width !== width || composite.height !== height) composite = new OffscreenCanvas(width, height);
    const context = composite.getContext("2d", { alpha: false })!;
    // Video has no alpha: transparent canvas pixels become black, as they encode without overlays.
    context.fillRect(0, 0, width, height);
    context.drawImage(frame, 0, 0);
    const scale = width / canvas.clientWidth;
    const origin = canvas.getBoundingClientRect();
    for (const element of overlays) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const line = Number.parseFloat(style.borderTopWidth) * scale;
      context.lineWidth = line;
      context.strokeStyle = style.borderTopColor;
      context.strokeRect(
        (rect.left - origin.left) * scale + line / 2,
        (rect.top - origin.top) * scale + line / 2,
        rect.width * scale - line,
        rect.height * scale - line,
      );
    }
    return new VideoFrame(composite, { timestamp });
  };
  // An overlay can move or toggle without a canvas redraw: re-send the frame.
  const overlayChanges = new MutationObserver(() => {
    stale = true;
    refinements = 0;
    pump();
  });
  if (canvas.parentElement) overlayChanges.observe(canvas.parentElement, { subtree: true, attributeFilter: ["style"] });

  void (async () => {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done) return;
      // 4:2:0 codecs need even dimensions: crop the odd pixel instead of rescaling.
      const width = frame.displayWidth & ~1;
      const height = frame.displayHeight & ~1;
      if (width < 2 || height < 2) {
        frame.close();
        continue;
      }
      // Canvas capture delivers the first draw after a resize at the old size, and a
      // still scene never draws again: drop the stale frame and draw once more.
      if (frame.displayWidth !== canvas.width || frame.displayHeight !== canvas.height) {
        frame.close();
        redraw();
        continue;
      }
      if (`${width}x${height}` !== size) {
        size = `${width}x${height}`;
        await configure(width, height);
      }
      last?.close();
      last = new VideoFrame(frame, { visibleRect: { x: 0, y: 0, width, height } });
      frame.close();
      stale = true;
      refinements = 0;
      pump();
    }
  })().catch(fail);

  return {
    keyframe() {
      forceKey = true;
      stale = true; // a still scene composites no new frame: re-send the last one
      pump();
    },
    stop() {
      clearTimeout(timer);
      clearTimeout(refineTimer);
      overlayChanges.disconnect();
      void reader.cancel();
      track.stop();
      last?.close();
      if (encoder?.state !== "closed") encoder?.close();
    },
  };
}

export function RenderPageBridge({ page }: { page: { session: string; fps: number; bpp: number } }) {
  const { remote } = useImageViewerServices();
  const { state, actions, meta } = useViewer();
  const canvas = meta.runtime?.canvas ?? null;
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<CanvasStream | null>(null);
  /** Seq of the last action applied; the tile ignores state older than its own edits. */
  const ackRef = useRef(0);
  const latest = useRef({ state, actions, runtime: meta.runtime });

  const publish = () => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return;
    const { layers: _layers, ...published } = latest.current.state;
    socket.send(JSON.stringify({ _type: "render/state", ack: ackRef.current, state: published }));
  };

  useEffect(() => {
    latest.current = { state, actions, runtime: meta.runtime };
    publish();
  }, [state, actions, meta.runtime]);

  useEffect(() => {
    if (!canvas) return;
    const socket = remote.connect(page.session);
    socketRef.current = socket;
    socket.onopen = () => {
      publish();
      streamRef.current = streamCanvas(canvas, socket, page, () => latest.current.runtime?.requestRender());
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as { _type: string; seq?: number; name?: RemoteAction; args?: unknown[] };
      if (message._type === "render/keyframe") streamRef.current?.keyframe();
      if (message._type !== "render/action" || !REMOTE_ACTIONS.includes(message.name!)) return;
      ackRef.current = message.seq ?? 0;
      const action = latest.current.actions[message.name!] as (...args: unknown[]) => void;
      action(...(message.args ?? []));
    };
    return () => {
      streamRef.current?.stop();
      streamRef.current = null;
      socket.close();
      socketRef.current = null;
    };
  }, [canvas, remote, page]);

  return null;
}
