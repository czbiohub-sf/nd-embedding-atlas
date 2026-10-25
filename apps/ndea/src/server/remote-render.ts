/**
 * Remote rendering: an image viewer with `render: "remote"` renders in a
 * headless Chrome tab beside the data; the tab encodes its canvas with
 * WebCodecs and the server relays the chunks to the viewer's browser.
 *
 * `/ws/render` carries one session per socket, so a session dies with its
 * socket. The viewer's socket (no query) sends JSON:
 *   render/start {element, width, height, dpr} · render/resize {width, height, dpr}
 *   render/input {events} · render/action {seq, name, args} · render/keyframe · render/stop
 * and receives the page's JSON (render/config, render/state, render/error)
 * plus binary chunks: `u8 flags (bit 0: key) · f64 capture time (epoch ms) · chunk`.
 * The headless tab connects with `?session=<token>`, an unguessable id only
 * the server hands to the tab it opened.
 *
 * Trust: the same as `/ws` and `/plate/*` (loopback, or an SSH tunnel to it);
 * the stream shows nothing those routes don't already serve.
 */

import type { Server, ServerWebSocket } from "bun";
import { findElement } from "../frontend/core/workspace/dashboard.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import { launchChrome, openTab, type Chrome } from "./chrome.ts";
import type { ServerSocketContext } from "./ws.ts";

const knob = (name: string, fallback: number) => Number(process.env[name]) || fallback;
// ponytail: fixed caps for one shared GPU; per-user quotas and adaptive bitrate when nodes are shared.
const MAX_SESSIONS = knob("NDEA_RENDER_SESSIONS", 2);
/** Device pixels per stream; a larger tile renders at a lower device pixel ratio. */
const MAX_PIXELS = knob("NDEA_RENDER_MAX_PIXELS", 2560 * 1440);
// Hardware H.264 holds ~53 fps at 2380×1344 on an M4 Max; a slower encoder just paces lower.
const FPS = knob("NDEA_RENDER_FPS", 60);
/** Encoder bitrate = pixels × fps × this. */
const BITS_PER_PIXEL = knob("NDEA_RENDER_BPP", 0.1);
/** Bytes queued to a viewer before delta frames drop until the next keyframe. */
const CLIENT_BUFFER_LIMIT = 1 << 20;

interface RenderSession {
  readonly token: string;
  readonly client: RenderSocket;
  page: RenderSocket | null;
  tab: { targetId: string; sessionId: string } | null;
  /** A delta was dropped: forward nothing until a keyframe. */
  needKey: boolean;
  closed: boolean;
}

export interface RenderSocketData {
  role: "client" | "page";
  session: RenderSession | null;
  /** Where the headless tab loads the app: this server, over loopback. */
  origin: string;
}

type RenderSocket = ServerWebSocket<ServerSocketContext & { render: RenderSocketData }>;

export const isRenderSocket = (ws: ServerWebSocket<ServerSocketContext>): ws is RenderSocket =>
  ws.data.render !== undefined;

const sessions = new Map<string, RenderSession>();
let chrome: Promise<Chrome> | null = null;

function getChrome(): Promise<Chrome> {
  chrome ??= launchChrome().then((browser) => {
    console.log(`[render] ${browser.version} (${browser.path})`);
    browser.on(({ method, params }) => {
      if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as { exception?: { description?: string }; text: string };
        console.error(`[render] page error: ${details.exception?.description ?? details.text}`);
      }
    });
    void browser.exited.then(() => {
      chrome = null;
      for (const session of sessions.values()) closeSession(session, "the headless browser exited");
    });
    return browser;
  });
  chrome.catch(() => (chrome = null));
  return chrome;
}

/** The `/ws/render` upgrade data, or null to refuse: a page must name a live session without a page. */
export function renderSocketData(req: Request, server: Server<ServerSocketContext>): RenderSocketData | null {
  const token = new URL(req.url).searchParams.get("session");
  // Chrome needs a secure context for WebCodecs: loopback is one.
  const host = ["0.0.0.0", "::", "localhost"].includes(server.hostname ?? "") ? "127.0.0.1" : server.hostname;
  const origin = `http://${host?.includes(":") ? `[${host}]` : host}:${server.port}`;
  if (token === null) return { role: "client", session: null, origin };
  const session = sessions.get(token);
  return session && !session.page ? { role: "page", session, origin } : null;
}

/** Clamp a requested viewport to the pixel cap by lowering its device pixel ratio. */
function viewport(width: unknown, height: unknown, dpr: unknown) {
  const w = Math.max(16, Math.min(4096, Math.round(Number(width) || 0)));
  const h = Math.max(16, Math.min(4096, Math.round(Number(height) || 0)));
  const ratio = Math.max(0.25, Math.min(3, Number(dpr) || 1));
  return { width: w, height: h, deviceScaleFactor: Math.min(ratio, Math.sqrt(MAX_PIXELS / (w * h))), mobile: false };
}

const send = (ws: RenderSocket, message: Record<string, unknown>) => ws.send(JSON.stringify(message));

function closeSession(session: RenderSession, error?: string): void {
  if (session.closed) return;
  session.closed = true;
  sessions.delete(session.token);
  if (error) {
    console.error(`[render] session closed: ${error}`);
    send(session.client, { _type: "render/error", error });
  }
  session.page?.close();
  const tab = session.tab;
  if (!tab) return;
  void chrome
    ?.then(async (browser) => {
      await browser.send("Target.closeTarget", { targetId: tab.targetId });
      const { targetInfos } = await browser.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>(
        "Target.getTargets",
      );
      // closeTarget answers before the target is gone, so leave the closed one out.
      const open = targetInfos.filter(
        (target) => target.type === "page" && target.url.includes("/render/") && target.targetId !== tab.targetId,
      ).length;
      console.log(`[render] closed a session; ${open} render tab(s) open`);
    })
    .catch(() => {});
}

async function startSession(ws: RenderSocket, frame: Record<string, unknown>): Promise<void> {
  const { state, render } = ws.data;
  if (render.session && !render.session.closed) {
    return void send(ws, { _type: "render/error", error: "this socket already has a session" });
  }
  const element = typeof frame.element === "string" ? frame.element : "";
  const document = state.workspace.get().document as WorkspaceDocument;
  if (findElement(document, element)?.type !== "image-viewer") {
    return void send(ws, { _type: "render/error", error: `no image-viewer element "${element}"` });
  }
  if (sessions.size >= MAX_SESSIONS) {
    return void send(ws, {
      _type: "render/error",
      error: `remote rendering is at its limit of ${MAX_SESSIONS} sessions (NDEA_RENDER_SESSIONS)`,
    });
  }
  const session: RenderSession = {
    token: crypto.randomUUID(),
    client: ws,
    page: null,
    tab: null,
    needKey: false,
    closed: false,
  };
  sessions.set(session.token, session);
  render.session = session;
  console.log(`[render] session for "${element}" (${sessions.size}/${MAX_SESSIONS})`);
  send(ws, { _type: "render/status", status: "starting" });
  try {
    const browser = await getChrome();
    const query = new URLSearchParams({
      element,
      session: session.token,
      fps: String(FPS),
      bpp: String(BITS_PER_PIXEL),
    });
    const tab = await openTab(browser, "about:blank");
    session.tab = tab;
    if (session.closed) return void browser.send("Target.closeTarget", { targetId: tab.targetId }).catch(() => {});
    await browser.send("Runtime.enable", {}, tab.sessionId);
    await browser.send(
      "Emulation.setDeviceMetricsOverride",
      viewport(frame.width, frame.height, frame.dpr),
      tab.sessionId,
    );
    await browser.send("Page.navigate", { url: `${render.origin}/render/image?${query}` }, tab.sessionId);
  } catch (error) {
    closeSession(session, error instanceof Error ? error.message : String(error));
  }
}

const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;
const BUTTONS = ["left", "middle", "right"] as const;
const MOUSE_TYPES = { down: "mousePressed", move: "mouseMoved", up: "mouseReleased", wheel: "mouseWheel" } as const;

interface InputEvent {
  type: keyof typeof MOUSE_TYPES;
  x: number;
  y: number;
  button?: number;
  buttons?: number;
  dx?: number;
  dy?: number;
  mods?: (keyof typeof MODIFIERS)[];
}

/** Replay the viewer's pointer and wheel input into the tab as real (trusted) mouse events. */
function dispatchInput(session: RenderSession, events: unknown): void {
  const tab = session.tab;
  if (!tab || !Array.isArray(events)) return;
  void chrome?.then((browser) => {
    for (const event of events as InputEvent[]) {
      const type = MOUSE_TYPES[event.type];
      if (!type) continue;
      void browser
        .send(
          "Input.dispatchMouseEvent",
          {
            type,
            x: Number(event.x) || 0,
            y: Number(event.y) || 0,
            button: event.type === "move" || event.type === "wheel" ? "none" : (BUTTONS[event.button ?? 0] ?? "left"),
            buttons: Number(event.buttons) || 0,
            clickCount: event.type === "move" || event.type === "wheel" ? 0 : 1,
            deltaX: Number(event.dx) || 0,
            deltaY: Number(event.dy) || 0,
            modifiers: (event.mods ?? []).reduce((bits, mod) => bits | (MODIFIERS[mod] ?? 0), 0),
          },
          tab.sessionId,
        )
        .catch(() => {});
    }
  });
}

function clientMessage(ws: RenderSocket, frame: Record<string, unknown>): void {
  const session = ws.data.render.session;
  if (frame._type === "render/start") return void startSession(ws, frame);
  if (!session || session.closed) return;
  switch (frame._type) {
    case "render/stop":
      return closeSession(session);
    case "render/resize": {
      const tab = session.tab;
      if (!tab) return;
      void chrome
        ?.then((browser) =>
          browser.send(
            "Emulation.setDeviceMetricsOverride",
            viewport(frame.width, frame.height, frame.dpr),
            tab.sessionId,
          ),
        )
        .catch(() => {});
      return;
    }
    case "render/input":
      return dispatchInput(session, frame.events);
    case "render/action":
    case "render/keyframe":
      session.page?.send(JSON.stringify(frame));
      return;
  }
}

/** Relay a chunk; when the viewer falls behind, drop deltas and ask for a keyframe instead of queueing stale video. */
function relayChunk(session: RenderSession, chunk: Buffer): void {
  const key = (chunk[0] & 1) === 1;
  if (!key && (session.needKey || session.client.getBufferedAmount() > CLIENT_BUFFER_LIMIT)) {
    if (!session.needKey) session.page?.send(JSON.stringify({ _type: "render/keyframe" }));
    session.needKey = true;
    return;
  }
  // 0: Bun dropped the message, so the decoder lost a reference frame.
  session.needKey = session.client.send(chunk) === 0;
}

export function handleRenderOpen(ws: RenderSocket): void {
  const { role, session } = ws.data.render;
  if (role === "page" && session) session.page = ws;
}

export function handleRenderMessage(ws: RenderSocket, raw: string | Buffer): void {
  const { role, session } = ws.data.render;
  if (role === "page") {
    if (!session || session.closed) return;
    // The page is ndea's own render route: relay its JSON as is.
    if (typeof raw === "string") session.client.send(raw);
    else relayChunk(session, raw);
    return;
  }
  if (typeof raw !== "string") return;
  try {
    clientMessage(ws, JSON.parse(raw) as Record<string, unknown>);
  } catch {
    send(ws, { _type: "render/error", error: "invalid render frame" });
  }
}

export function handleRenderClose(ws: RenderSocket): void {
  const { role, session } = ws.data.render;
  if (!session) return;
  closeSession(session, role === "page" && !session.closed ? "the render page disconnected" : undefined);
}

/** Server shutdown: close every session and the browser. */
export async function stopRemoteRender(): Promise<void> {
  for (const session of sessions.values()) closeSession(session);
  const running = chrome;
  chrome = null;
  await running?.then((browser) => browser.close()).catch(() => {});
}
