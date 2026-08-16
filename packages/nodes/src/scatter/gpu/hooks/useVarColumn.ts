import { type VarColumnBody, VarColumnResponseSchema, VarColumnStatusResponseSchema } from "@ndea/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScatterServices } from "../../context";

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

/**
 * Materializes a var column (one feature's values) in DuckDB on demand.
 *
 * Flow:
 *   POST /api/var-column { name, layer }
 *   → if WS connected: subscribe("var-column/status"): server pushes
 *     loading → ready/error transitions.
 *   → else: fall back to HTTP polling every 800 ms.
 *   → on status="ready": set column
 *   → on status="error": set error
 */
interface UseVarColumnOptions {
  /** Called with a status message when loading starts/ends: use to update the bottom bar. */
  onStatus?: (msg: string | null) => void;
}

export function useVarColumn(options?: UseVarColumnOptions): VarColumnResult {
  const { wsClient, isReconnectError } = useScatterServices();
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
      const poll = async () => {
        try {
          const res = await fetch(`/api/var-column/${taskId}/status`);
          if (!res.ok) {
            clearInterval(handle);
            handleError(`Poll failed: ${res.status}`);
            return;
          }
          const data = VarColumnStatusResponseSchema.parse(await res.json());
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
      };
      const handle = setInterval(() => {
        void poll();
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
        (raw) => {
          const parsed = VarColumnStatusResponseSchema.safeParse(raw);
          if (!parsed.success) {
            sub.unsubscribe();
            handleError("Invalid var-column status response");
            return;
          }
          const msg = parsed.data;
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
          if (isReconnectError(err)) {
            // WS dropped mid-stream: switch to HTTP polling for the same task.
            startHttpPoll(taskId);
          } else {
            handleError(err.message);
          }
        },
      );
      stopRef.current = () => sub.unsubscribe();
    },
    [handleError, handleReady, isReconnectError, startHttpPoll, wsClient],
  );

  const materialize = useCallback(
    (name: string, layer: string, modality?: string) => {
      stopWatching();
      setState({ status: "loading", column: null, error: null });
      onStatusRef.current?.(`Materializing ${name}…`);

      const run = async () => {
        let taskId: string;
        try {
          const body = {
            name,
            layer,
            ...(modality ? { modality } : {}),
          } satisfies VarColumnBody;
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
          const data = VarColumnResponseSchema.parse(await res.json());
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
    [handleError, startHttpPoll, startWsSubscribe, stopWatching, wsClient],
  );

  return {
    materialize,
    status: state.status,
    column: state.column,
    error: state.error,
  };
}
