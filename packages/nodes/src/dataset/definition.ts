import { z } from "zod";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { DatasetCapabilities, DatasetConfig } from "./contracts";
import { DatasetBody } from "./body";

export function createDatasetDefinition({ mountBody }: { mountBody: NodeBodyMounter }) {
  return defineNode({
    ref: exactNodeTypeRef("dataset", "1.0.0"),
    title: "Dataset",
    role: "transform",
    inputs: [],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: ["data-read"] satisfies readonly DatasetCapabilities[],
    config: {
      schema: z.object({ datasetKey: z.string().nullable() }),
      version: nodeConfigVersion(1),
      defaultValue: { datasetKey: null } satisfies DatasetConfig,
      migrations: [
        {
          from: nodeConfigVersion(0),
          to: nodeConfigVersion(1),
          migrate: (value) => ({
            datasetKey:
              typeof value === "object" && value !== null && !Array.isArray(value)
                ? (((value as Record<string, unknown>).datasetKey as string | null | undefined) ?? null)
                : null,
          }),
        },
      ],
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      return { mountBody: (host) => mountBody(DatasetBody, host, "Dataset") };
    },
  });
}
