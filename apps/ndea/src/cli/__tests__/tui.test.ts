import { expect, test } from "bun:test";
import { renderStatus } from "../tui.ts";

test("renderStatus shows each dataset's facts and the workspace, not embeddings or clients panels", () => {
  const now = Date.parse("2026-01-01T01:00:00Z");
  const text = renderStatus(
    {
      server: {
        version: "1.2.3",
        url: "http://localhost:5132",
        startedAt: "2026-01-01T00:00:00Z",
        rss: 200 * 2 ** 20,
        ingest: "cached",
      },
      datasets: [
        {
          name: "infectomics",
          format: "anndata",
          path: "/data/i.zarr",
          observations: 70121,
          variables: 768,
          obsColumns: 14,
          embeddings: ["X_umap", "X_pca"],
          plate: {
            path: "/data/plate.zarr",
            wells: 96,
            channels: [
              { name: "Phase3D", color: "#FFFFFF" },
              { name: "SEC61", color: "#00FF00" },
            ],
          },
          bytes: 3 * 2 ** 30,
        },
        {
          name: "multi",
          format: "mudata",
          path: "/data/m.zarr",
          observations: 10,
          variables: 50,
          obsColumns: 2,
          modalities: [{ name: "rna", observations: 10, variables: 40 }],
          embeddings: [],
        },
      ],
      embeddings: { available: ["X_umap"], loading: ["X_pca"], errors: {} },
      workspace: {
        path: "/tmp/w.json",
        revision: 4,
        recent: [{ revision: 4, actor: { kind: "mcp", agent: "omp" }, ops: 2, committedAt: "2026-01-01T00:59:30Z" }],
      },
      clients: { browserSockets: 1, mcpInFlight: 0, agents: [{ agent: "omp", lastSeen: "2026-01-01T00:59:55Z" }] },
      logs: [],
    },
    now,
  );
  for (const part of [
    "ndea v1.2.3  http://localhost:5132  up 1h0m  rss 200 MB  ingest cached",
    "format      anndata · 70,121 obs × 768 var · 14 obs columns",
    "embeddings  2  X_umap X_pca",
    "images      96 wells  ■ Phase3D  ■ SEC61",
    "plate       /data/plate.zarr",
    "storage     3.0 GB  /data/i.zarr",
    "modalities  rna 10 × 40",
    "storage     …  /data/m.zarr",
    "/tmp/w.json · revision 4 · last omp (mcp) 30s ago",
  ])
    expect(text).toContain(part);
  for (const gone of ["Embeddings", "Clients", "browser sockets"]) expect(text).not.toContain(gone);
});
