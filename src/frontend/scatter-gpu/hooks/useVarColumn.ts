import { useCallback, useEffect, useRef, useState } from "react";
import { WsReconnectError, wsClient } from "../../lib/ws-client";

type VarColumnStatus = "idle" | "loading" | "ready" | "error";

interface VarColumnState {
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

export interface VarColumnResult {
  materialize: (name: string, layer: string, modality?: string) => void;
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

interface StatusMsg {
  status: string;
  column?: string;
  error?: string;
}

interface PostVarColumnResponse {
  task_id: string;
}

/**
 * Materializes a var column (one feature's values) in DuckDB on demand.
 *
 * Flow:
 *   POST /api/var-column { name, layer }
 *   → if WS connected: subscribe("var-column/status") — server pushes
 *     loading → ready/error transitions.
 *   → else: fall back to HTTP polling every 800 ms.
 *   → on status="ready": set column
 *   → on status="error": set error
 */
interface UseVarColumnOptions {
  /** Called with a status message when loading starts/ends — use to update the bottom bar. */
  onStatus?: (msg: string | null) => void;
}

export function useVarColumn(options?: UseVarColumnOptions): VarColumnResult {
  const onStatusRef = useRef(options?.onStatus);
  onStatusRef.current = options?.onStatus;

  const [state, setState] = useState<VarColumnState>({
    status: "idle",
    column: null,
    error: null,
  });

  // Disposer for whichever watcher is active (WS sub or poll interval).
  const stopRef = useRef<(() => void) | null>(null);

  const stopWatching = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  // Clear any in-flight watcher on unmount so an abandoned materialize()
  // call doesn't keep pushing updates.
  useEffect(() => stopWatching, [stopWatching]);

  const handleReady = useCallback((column: string | null) => {
    stopRef.current = null;
    setState({ status: "ready", column, error: null });
    onStatusRef.current?.(null);
  }, []);

  const handleError = useCallback((error: string) => {
    stopRef.current = null;
    setState({ status: "error", column: null, error });
    onStatusRef.current?.(null);
  }, []);

  const startHttpPoll = useCallback(
    (taskId: string) => {
      // eslint-disable-next-line no-misused-promises
      const handle = setInterval(async () => {
        try {
          const res = await fetch(`/api/var-column/${taskId}/status`);
          if (!res.ok) {
            clearInterval(handle);
            handleError(`Poll failed: ${res.status}`);
            return;
          }
          const data = (await res.json()) as StatusMsg;
          if (data.status === "ready") {
            clearInterval(handle);
            handleReady(data.column ?? null);
          } else if (data.status === "error") {
            clearInterval(handle);
            handleError(data.error ?? "Unknown error");
          }
          // "loading" → keep polling
        } catch (err) {
          clearInterval(handle);
          handleError(String(err));
        }
      }, 800);
      stopRef.current = () => clearInterval(handle);
    },
    [handleError, handleReady],
  );

  const startWsSubscribe = useCallback(
    (taskId: string) => {
      const sub = wsClient.subscribe(
        "var-column/status",
        { task_id: taskId },
        (msg: StatusMsg) => {
          if (msg.status === "ready") {
            sub.unsubscribe();
            handleReady(msg.column ?? null);
          } else if (msg.status === "error") {
            sub.unsubscribe();
            handleError(msg.error ?? "Unknown error");
          }
          // "loading" → keep the subscription alive
        },
        (err) => {
          if (err instanceof WsReconnectError) {
            // WS dropped mid-stream — switch to HTTP polling for the same task.
            startHttpPoll(taskId);
          } else {
            handleError(err.message);
          }
        },
      );
      stopRef.current = () => sub.unsubscribe();
    },
    [handleError, handleReady, startHttpPoll],
  );

  const materialize = useCallback(
    (name: string, layer: string, modality?: string) => {
      stopWatching();
      setState({ status: "loading", column: null, error: null });
      onStatusRef.current?.(`Materializing ${name}…`);

      const run = async () => {
        let taskId: string;
        try {
          const body: Record<string, string> = { name, layer };
          if (modality) body.modality = modality;
          const res = await fetch("/api/var-column", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const text = await res.text();
            handleError(text);
            return;
          }
          const data = (await res.json()) as PostVarColumnResponse;
          taskId = data.task_id;
        } catch (err) {
          handleError(String(err));
          return;
        }

        if (wsClient.isConnected) {
          startWsSubscribe(taskId);
        } else {
          startHttpPoll(taskId);
        }
      };

      run().catch((err: unknown) => handleError(String(err)));
    },
    [handleError, startHttpPoll, startWsSubscribe, stopWatching],
  );

  return {
    materialize,
    status: state.status,
    column: state.column,
    error: state.error,
  };
}
