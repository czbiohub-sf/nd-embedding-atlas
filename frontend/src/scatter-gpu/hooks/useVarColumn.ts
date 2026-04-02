import { useCallback, useRef, useState } from "react";

type VarColumnStatus = "idle" | "loading" | "ready" | "error";

interface VarColumnState {
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

export interface VarColumnResult {
  materialize: (gene: string, layer: string) => void;
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

interface TaskStatusResponse {
  status: "pending" | "running" | "ready" | "error";
  column?: string;
  error?: string;
}

interface PostVarColumnResponse {
  task_id: string;
}

/**
 * Materializes a gene expression column in DuckDB on demand.
 *
 * Flow:
 *   POST /api/gene-column { gene, layer }
 *   → poll GET /api/gene-column/{task_id}/status every 800ms
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

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const materialize = useCallback(
    (gene: string, layer: string) => {
      stopPolling();
      setState({ status: "loading", column: null, error: null });
      onStatusRef.current?.(`Materializing ${gene}…`);

      const run = async () => {
        let taskId: string;
        try {
          const res = await fetch("/api/gene-column", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gene, layer }),
          });
          if (!res.ok) {
            const text = await res.text();
            setState({ status: "error", column: null, error: text });
            return;
          }
          const data = (await res.json()) as PostVarColumnResponse;
          taskId = data.task_id;
        } catch (err) {
          setState({ status: "error", column: null, error: String(err) });
          return;
        }

        pollIntervalRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/gene-column/${taskId}/status`);
            if (!res.ok) {
              stopPolling();
              setState({ status: "error", column: null, error: `Poll failed: ${res.status}` });
              return;
            }
            const data = (await res.json()) as TaskStatusResponse;
            if (data.status === "ready") {
              stopPolling();
              setState({ status: "ready", column: data.column ?? null, error: null });
              onStatusRef.current?.(null);
            } else if (data.status === "error") {
              stopPolling();
              setState({ status: "error", column: null, error: data.error ?? "Unknown error" });
              onStatusRef.current?.(null);
            }
            // "pending" | "running" → keep polling
          } catch (err) {
            stopPolling();
            setState({ status: "error", column: null, error: String(err) });
            onStatusRef.current?.(null);
          }
        }, 800);
      };

      run().catch((err) => {
        setState({ status: "error", column: null, error: String(err) });
      });
    },
    [stopPolling],
  );

  return {
    materialize,
    status: state.status,
    column: state.column,
    error: state.error,
  };
}
