import { useCallback, useRef, useState } from "react";
import { EmbeddingStatusSchema } from "../lib/schemas";
import type { Metadata } from "../types";

async function pollUntilReady(key: string, signal: AbortSignal): Promise<void> {
  for (;;) {
    const res = await fetch(`/api/embeddings/${key}/status`, { signal });
    const parsed = EmbeddingStatusSchema.parse(await res.json());
    if (parsed.status === "ready") return;
    if (parsed.status === "error") {
      const msg = `Failed to load embedding ${key}`;
      throw new Error(msg);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function useEmbeddingLoader(metadata: Metadata | null, refreshMetadata: () => Promise<void>) {
  const abortRef = useRef<AbortController | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const loadEmbedding = useCallback(
    async (key: string) => {
      if (!metadata) return;
      const entry = metadata.obsm[key];
      if (entry && !entry.loaded) {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoadingKey(key);
        try {
          await fetch(`/api/embeddings/${key}`, {
            method: "POST",
            signal: controller.signal,
          });
          await pollUntilReady(key, controller.signal);
          await refreshMetadata();
        } finally {
          setLoadingKey(null);
          abortRef.current = null;
        }
      }
    },
    [metadata, refreshMetadata],
  );

  return { loadEmbedding, loadingKey };
}
