import { describe, expect, test } from "bun:test";
import type { PlateChannel, PlateMetaInfo, PlateMount } from "../../server/plate.ts";
import { startup } from "../startup.ts";
import { sortObsmKeys } from "../startup/datasets.ts";
import { selectIngestStrategy, shouldUseIngestCache } from "../startup/ingest.ts";
import { buildPlateMetadata } from "../startup/session.ts";

const CHANNEL: PlateChannel = {
  label: "DNA",
  color: "3366FF",
  window: { start: 10, end: 900, min: 0, max: 4095 },
};

test("retains the public startup entrypoint", () => {
  expect(typeof startup).toBe("function");
});

function plateInfo(omeVersion: "0.4" | "0.5", scale: number): PlateMetaInfo {
  return { omeVersion, channels: [CHANNEL], pixelScale: { x: scale, y: scale } };
}

describe("startup ingest strategy", () => {
  test("keeps MuData on its merge-aware initializer in every mode", () => {
    expect(selectIngestStrategy(true, false, "chunked")).toBe("mudata");
    expect(selectIngestStrategy(true, false, "stream")).toBe("mudata");
    expect(selectIngestStrategy(true, false, "eager")).toBe("mudata");
  });

  test("uses chunked ingest only for a single AnnData dataset", () => {
    expect(selectIngestStrategy(false, false, "chunked")).toBe("chunked");
    expect(selectIngestStrategy(false, true, "chunked")).toBe("streaming");
  });

  test("preserves explicit eager and streaming selection", () => {
    expect(selectIngestStrategy(false, false, "eager")).toBe("eager");
    expect(selectIngestStrategy(false, true, "eager")).toBe("eager");
    expect(selectIngestStrategy(false, false, "stream")).toBe("streaming");
  });

  test("enables cache only for non-eager local AnnData ingest", () => {
    expect(shouldUseIngestCache("chunked", true, false, false)).toBe(true);
    expect(shouldUseIngestCache("stream", true, false, false)).toBe(true);
    expect(shouldUseIngestCache("eager", true, false, false)).toBe(false);
    expect(shouldUseIngestCache("chunked", false, false, false)).toBe(false);
    expect(shouldUseIngestCache("chunked", true, true, false)).toBe(false);
    expect(shouldUseIngestCache("chunked", true, false, true)).toBe(false);
  });
});

describe("startup metadata ordering", () => {
  test("orders known embeddings by UI priority and unknown names alphabetically", () => {
    expect(sortObsmKeys(["custom_z", "X_pca", "X_phate", "X_umap", "custom_a", "X_tsne"])).toEqual([
      "X_umap",
      "X_tsne",
      "X_phate",
      "X_pca",
      "custom_a",
      "custom_z",
    ]);
  });

  test("preserves mount order, prefers OME 0.5, and uses first plate display metadata", () => {
    const mounts: PlateMount[] = [
      { mount: "/plate/cells", diskPath: "/data/cells", datasetKey: "cells" },
      { mount: "/plate/tissue", diskPath: "/data/tissue", datasetKey: "tissue" },
    ];
    const tissueInfo = plateInfo("0.5", 0.5);
    const metadata = new Map<string, PlateMetaInfo | null>([
      ["/plate/cells", plateInfo("0.4", 0.25)],
      ["/plate/tissue", tissueInfo],
    ]);

    expect(buildPlateMetadata(mounts, metadata, true)).toEqual({
      plateMeta: {
        plate_stores: [
          { mount: "/plate/cells", name: "cells", ome_version: "0.4" },
          { mount: "/plate/tissue", name: "tissue", ome_version: "0.5" },
        ],
        plate_ome_version: "0.5",
        plate_channels: [CHANNEL],
        plate_pixel_scale: { x: 0.25, y: 0.25 },
      },
      datasetChannels: { cells: [CHANNEL], tissue: tissueInfo.channels },
    });
  });

  test("omits per-dataset channels for a single mount", () => {
    const mounts: PlateMount[] = [{ mount: "/plate", diskPath: "/data/cells", datasetKey: null }];
    expect(buildPlateMetadata(mounts, new Map([["/plate", plateInfo("0.4", 1)]]), false).datasetChannels).toBeNull();
  });
});
