import { useCallback, useEffect, useRef, useState } from "react";

type VarColumnStatus = "idle" | "loading" | "ready" | "error";

interface VarColumnState {
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

export interface VarColumnResult {
  materialize: (varName: string, layer: string, modality?: string) => void;
  status: VarColumnStatus;
  column: string | null;
  error: string | null;
}

interface PostVarColumnResponse {
  task_id: string;
}

interface SseVarStatusEvent {
  status: "loading" | "ready" | "error";
  column?: string;
  vmin?: number;
  vmax?: number;
  error?: string;
}

/**
 * Materializes a var (gene/feature) expression column in DuckDB on demand.
 *
 * Flow:
 *   POST /api/var-column { gene, layer }
 *   -> open SSE stream GET /api/var-column/{task_id}/stream
 *   -> on status="ready": set column
 *   -> on status="error": set error
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

  const eventSourceRef = useRef<EventSource | null>(null);
  const generationRef = useRef(0);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => closeStream, [closeStream]);

  const materialize = useCallback(
    (varName: string, layer: string, modality?: string) => {
      // Tear down any previous stream
      closeStream();
      setState({ status: "loading", column: null, error: null });
      onStatusRef.current?.(`Materializing ${varName}…`);

      const gen = ++generationRef.current;

      const run = async () => {
        let taskId: string;
        try {
          const body: Record<string, string> = { gene: varName, layer };
          if (modality) body.modality = modality;
          const res = await fetch("/api/var-column", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const text = await res.text();
            setState({ status: "error", column: null, error: text });
            onStatusRef.current?.(null);
            return;
          }
          const data = (await res.json()) as PostVarColumnResponse;
          taskId = data.task_id;
        } catch (err) {
          setState({ status: "error", column: null, error: String(err) });
          onStatusRef.current?.(null);
          return;
        }

        // Superseded by a newer call — don't open EventSource
        if (gen !== generationRef.current) return;

        // Open SSE stream for status updates
        const es = new EventSource(`/api/var-column/${taskId}/stream`);
        eventSourceRef.current = es;

        es.addEventListener("status", (evt: MessageEvent) => {
          let data: SseVarStatusEvent;
          try {
            data = JSON.parse(evt.data) as SseVarStatusEvent;
          } catch {
            es.close();
            eventSourceRef.current = null;
            setState({ status: "error", column: null, error: "Malformed SSE data" });
            onStatusRef.current?.(null);
            return;
          }
          if (data.status === "ready") {
            es.close();
            eventSourceRef.current = null;
            setState({ status: "ready", column: data.column ?? null, error: null });
            onStatusRef.current?.(null);
          } else if (data.status === "error") {
            es.close();
            eventSourceRef.current = null;
            setState({ status: "error", column: null, error: data.error ?? "Unknown error" });
            onStatusRef.current?.(null);
          }
        });

        es.addEventListener("error", () => {
          es.close();
          eventSourceRef.current = null;
          setState({ status: "error", column: null, error: "SSE connection failed" });
          onStatusRef.current?.(null);
        });
      };

      run().catch((err) => {
        setState({ status: "error", column: null, error: String(err) });
        onStatusRef.current?.(null);
      });
    },
    [closeStream],
  );

  return {
    materialize,
    status: state.status,
    column: state.column,
    error: state.error,
  };
}
