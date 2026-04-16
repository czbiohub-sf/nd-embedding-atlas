/**
 * Typed WebSocket client for the ndea server protocol.
 *
 * Single persistent connection per browser tab. Multiplexes requests via
 * monotonic `_id`s and the `NdeaProtocol` method map in `src/protocol/`.
 *
 * Features:
 *   - `call(method, req)` — single-shot request/response, Promise-based.
 *   - `subscribe(method, req, onData)` — long-lived push stream. Each data
 *     frame fires `onData`; the terminal frame also fires `onData` then
 *     unsubscribes automatically.
 *   - Exponential backoff reconnect (200 ms → 5 s) with jitter.
 *   - Send queue while disconnected; flushed on open.
 *
 * On disconnect:
 *   - Pending `call()` promises reject with `WsReconnectError`.
 *   - Active subscriptions receive an error via `onError` and are dropped.
 *     Callers are expected to re-establish subscriptions themselves on
 *     reconnect — keeps the client simple and leak-proof.
 */

import type { NdeaProtocol } from "../../protocol/index.ts";
import { setWsConnected, setWsError, setWsLatency } from "../stores/WsConnectionStore";

type ReqOf<M extends keyof NdeaProtocol> = NdeaProtocol[M]["req"];
type ResOf<M extends keyof NdeaProtocol> = NdeaProtocol[M]["res"];

interface PendingCall {
  resolve(value: unknown): void;
  reject(err: Error): void;
  sentAt: number;
}

interface SubEntry {
  onData(msg: unknown): void;
  onError?(err: Error): void;
}

interface WsFrame {
  _id?: number;
  _ch?: "data" | "end" | "error";
  error?: string;
  [k: string]: unknown;
}

export class WsReconnectError extends Error {
  constructor() {
    super("WebSocket disconnected");
    this.name = "WsReconnectError";
  }
}

const RECONNECT_BASE_MS = 200;
const RECONNECT_CAP_MS = 5000;

export class NdeaWsClient {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly subs = new Map<number, SubEntry>();
  private sendQueue: string[] = [];
  private retryAttempt = 0;
  private shuttingDown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  /** Open the connection if not already open/connecting. Idempotent. */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.shuttingDown = false;
    this.open();
  }

  /** Close the connection and cancel any pending reconnect. */
  close(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Single-shot typed request. Rejects on disconnect or error frame. */
  call<M extends keyof NdeaProtocol>(method: M, req: ReqOf<M>): Promise<ResOf<M>> {
    const id = this.nextId++;
    return new Promise<ResOf<M>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        sentAt: performance.now(),
      });
      this.sendFrame({ _id: id, _type: method as string, ...(req as Record<string, unknown>) });
    });
  }

  /**
   * Typed long-lived subscription. Fires `onData` for every data frame AND
   * for the terminal frame; then auto-unsubscribes. `onError` fires on
   * explicit error frames and on disconnect.
   */
  subscribe<M extends keyof NdeaProtocol>(
    method: M,
    req: ReqOf<M>,
    onData: (msg: ResOf<M>) => void,
    onError?: (err: Error) => void,
  ): { unsubscribe: () => void } {
    const id = this.nextId++;
    this.subs.set(id, {
      onData: onData as (v: unknown) => void,
      onError,
    });
    this.sendFrame({
      _id: id,
      _type: method as string,
      subscribe: true,
      ...(req as Record<string, unknown>),
    });
    return {
      unsubscribe: () => {
        if (!this.subs.has(id)) return;
        this.subs.delete(id);
        this.sendFrame({
          _id: this.nextId++,
          _type: "unsubscribe",
          target_id: id,
        });
      },
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retryAttempt = 0;
      setWsConnected(true);
      for (const raw of this.sendQueue) ws.send(raw);
      this.sendQueue = [];
    });
    ws.addEventListener("message", (ev) => this.onMessage(ev));
    ws.addEventListener("close", () => {
      setWsConnected(false);
      // Reject all in-flight calls and surface error to active subs.
      for (const p of this.pending.values()) p.reject(new WsReconnectError());
      this.pending.clear();
      for (const s of this.subs.values()) s.onError?.(new WsReconnectError());
      this.subs.clear();
      if (!this.shuttingDown) this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      setWsError("connection error");
    });
  }

  private scheduleReconnect(): void {
    this.retryAttempt++;
    const exp = Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** (this.retryAttempt - 1));
    const jitter = Math.random() * exp * 0.3;
    const delay = exp + jitter;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private onMessage(ev: MessageEvent): void {
    if (typeof ev.data !== "string") return;
    let frame: WsFrame;
    try {
      frame = JSON.parse(ev.data) as WsFrame;
    } catch {
      return;
    }
    const id = typeof frame._id === "number" ? frame._id : -1;
    if (id < 0) return;
    const ch = frame._ch;

    const sub = this.subs.get(id);
    if (sub) {
      if (ch === "error") {
        sub.onError?.(new Error(typeof frame.error === "string" ? frame.error : "ws error"));
        this.subs.delete(id);
        return;
      }
      sub.onData(frame);
      if (ch === "end") this.subs.delete(id);
      return;
    }

    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    setWsLatency(performance.now() - pending.sentAt);
    if (ch === "error") {
      pending.reject(new Error(typeof frame.error === "string" ? frame.error : "ws error"));
    } else {
      pending.resolve(frame);
    }
  }

  private sendFrame(frame: Record<string, unknown>): void {
    const raw = JSON.stringify(frame);
    if (this.ws !== null && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.sendQueue.push(raw);
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

function buildUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:5055/ws";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

/** Lazily-created process-wide client. Call `wsClient.connect()` to open. */
export const wsClient = new NdeaWsClient(buildUrl());
