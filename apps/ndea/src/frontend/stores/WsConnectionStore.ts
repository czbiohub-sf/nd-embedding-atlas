/**
 * TanStack Store for WebSocket connection status.
 *
 * Written by NdeaWsClient on connect/disconnect. Read by the status bar
 * indicator and by hooks that need to fall back to HTTP polling when the
 * WS isn't available.
 */
import { Store } from "@tanstack/store";

export interface WsConnectionState {
  /** True while the underlying WebSocket is in OPEN state. */
  connected: boolean;
  /** Last measured round-trip latency (ms), or null if unknown. */
  latencyMs: number | null;
  /** Last transport error message, or null if none. */
  lastError: string | null;
}

export const wsConnectionStore = new Store<WsConnectionState>({
  connected: false,
  latencyMs: null,
  lastError: null,
});

export function setWsConnected(connected: boolean): void {
  wsConnectionStore.setState((s) => ({
    ...s,
    connected,
    lastError: connected ? null : s.lastError,
  }));
}

export function setWsError(error: string): void {
  wsConnectionStore.setState((s) => ({ ...s, lastError: error }));
}

export function setWsLatency(latencyMs: number): void {
  wsConnectionStore.setState((s) => ({ ...s, latencyMs }));
}
