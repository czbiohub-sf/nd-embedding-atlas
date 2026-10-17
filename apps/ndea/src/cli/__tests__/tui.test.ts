import { expect, test } from "bun:test";
import { renderStatus } from "../tui.ts";

test("renderStatus shows every section", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const text = renderStatus(
    {
      server: { version: "1.2.3", url: "http://localhost:5132", startedAt: "2026-01-01T00:00:00Z", rss: 200 * 2 ** 20 },
      datasets: [{ name: "infectomics", path: "/data/i.zarr", observations: 70121, variables: 10 }],
      embeddings: { available: ["X_umap"], loading: ["X_pca"], errors: { X_bad: "boom" } },
      workspace: {
        path: "/tmp/w.json",
        revision: 4,
        last: {
          revision: 4,
          baseRevision: 3,
          actor: { kind: "mcp", agent: "omp" },
          ops: [],
          committedAt: "2026-01-01T00:59:30Z",
        },
      },
      clients: { browserSockets: 1, mcpInFlight: 0, agents: [{ agent: "omp", lastSeen: "2026-01-01T00:59:55Z" }] },
    },
    now,
  );
  for (const part of [
    "ndea v1.2.3  http://localhost:5132  up 1h0m  rss 200 MB",
    "infectomics  70,121 obs × 10 var  /data/i.zarr",
    "loading    X_pca",
    "X_bad: boom",
    "revision 4  last change: omp · 30s ago",
    "browser sockets 1",
    "agent omp  seen 5s ago",
    "q quit",
  ])
    expect(text).toContain(part);
});
