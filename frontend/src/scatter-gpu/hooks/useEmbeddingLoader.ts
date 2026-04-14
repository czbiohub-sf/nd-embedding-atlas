import { useCallback, useEffect, useRef, useState } from "react";
import type { Metadata } from "../../types";

interface SseStatusEvent {
  status: "loading" | "ready" | "error";
  error?: string;
}

export function useEmbeddingLoader(metadata: Metadata | null, refreshMetadata: () => Promise<void>) {
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const generationRef = useRef(0);

  // Close any active EventSource
  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Clean up on unmount
  useEffect(() => closeStream, [closeStream]);

  const loadEmbedding = useCallback(
    async (key: string) => {
      if (!metadata) return;
      const entry = metadata.obsm[key];
      if (entry && !entry.loaded) {
        // Tear down any previous stream
        closeStream();
        setLoadingKey(key);
        const gen = ++generationRef.current;

        try {
          // Trigger loading on the backend
          await fetch(`/api/embeddings/${key}`, { method: "POST" });

          // Superseded by a newer call — don't open EventSource
          if (gen !== generationRef.current) return;

          // Open SSE stream for status updates
          const es = new EventSource(`/api/embeddings/${key}/stream`);
          eventSourceRef.current = es;

          es.addEventListener("status", (evt: MessageEvent) => {
            let data: SseStatusEvent;
            try {
              data = JSON.parse(evt.data) as SseStatusEvent;
            } catch {
              es.close();
              eventSourceRef.current = null;
              setLoadingKey(null);
              return;
            }
            if (data.status === "ready") {
              es.close();
              eventSourceRef.current = null;
              void refreshMetadata().finally(() => setLoadingKey(null));
            } else if (data.status === "error") {
              es.close();
              eventSourceRef.current = null;
              setLoadingKey(null);
            }
          });

          es.addEventListener("error", () => {
            es.close();
            eventSourceRef.current = null;
            setLoadingKey(null);
          });
        } catch {
          closeStream();
          setLoadingKey(null);
        }
      }
    },
    [metadata, refreshMetadata, closeStream],
  );

  return { loadEmbedding, loadingKey };
}
