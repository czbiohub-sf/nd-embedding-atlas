/**
 * dataset — a per-dataset source: emits `_dataset = '<key>'`, or null (all
 * datasets) when no key is selected. The key lives in the node's config blob,
 * read live at cook time.
 */

import { z } from "zod";
import { DatasetSourceBody } from "@/core/workspace/canvas/node-extras";
import { defineWorkspaceNodeSpec } from "@/core/workspace/node-kit";
import { nodeConfig } from "@/core/graph/cook";

export interface DatasetConfig {
  datasetKey?: string | null;
}

export const datasetNode = defineWorkspaceNodeSpec({
  id: "dataset",
  type: "dataset",
  title: "Dataset",
  kind: "source",
  inputs: [],
  outputs: [{ id: "out", kind: "pred", label: "Out" }],
  config: z.object({ datasetKey: z.string().nullable().optional() }),
  configVersion: 1,
  evaluationRole: "source",
  cook: (_inputs, host) => {
    const key = nodeConfig<DatasetConfig>(host.node()).datasetKey;
    return { kind: "pred", sql: key ? `_dataset = '${key.replace(/'/g, "''")}'` : null };
  },
  Body: DatasetSourceBody,
  geometry: { chipW: 148, card: { w: 196, h: 96 }, full: { w: 196, h: 96 }, canFull: false },
  stage: "canvas-only",
  inPalette: true,
});
