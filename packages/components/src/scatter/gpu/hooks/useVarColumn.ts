import { type VarColumnBody, VarColumnResponseSchema, VarColumnStatusResponseSchema } from "@ndea/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

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
 *   → poll GET /api/var-column/:task_id/status every 800 ms
 *   → on status="ready": set column
 *   → on status="error": set error
 */
interface UseVarColumnOptions {
  /** Called once the materialized column is ready (event-time, not via an effect). */
  onReady?: (column: string) => void;
}

export function useVarColumn(options?: UseVarColumnOptions): VarColumnResult {
  const onReady = options?.onReady;
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const [state, setState] = useState<VarColumnState>({
    status: "idle",
    column: null,
    error: null,
  });

  // Disposer for the active poll interval.
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
    if (column) onReadyRef.current?.(column);
  }, []);

  const handleError = useCallback((error: string) => {
    stopRef.current = null;
    setState({ status: "error", column: null, error });
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

  const materialize = useCallback(
    (name: string, layer: string, modality?: string) => {
      stopWatching();
      setState({ status: "loading", column: null, error: null });

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

        startHttpPoll(taskId);
      };

      run().catch((err: unknown) => handleError(String(err)));
    },
    [handleError, startHttpPoll, stopWatching],
  );

  return {
    materialize,
    status: state.status,
    column: state.column,
    error: state.error,
  };
}
