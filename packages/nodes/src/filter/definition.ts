import { FilterClauseSchema, type FilterClause } from "@ndea/protocol";
import { defineNode, exactNodeTypeRef, nodeConfigVersion } from "@ndea/sdk";
import { z } from "zod";
import type { NodeBodyMounter } from "../contracts";

export interface FilterConfig {
  /** Null passes the upstream predicate through unchanged. */
  where: FilterClause | null;
}

export function createFilterDefinition({ mountBody }: { mountBody: NodeBodyMounter }) {
  return defineNode({
    ref: exactNodeTypeRef("filter", "1.0.0"),
    title: "Filter",
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [{ id: "out", kind: "pred", label: "Out" }],
    capabilities: [] as const,
    config: {
      schema: z.object({ where: FilterClauseSchema.nullable() }),
      version: nodeConfigVersion(1),
      defaultValue: { where: null } satisfies FilterConfig,
    },
    presentation: { icon: "filter" },
    documentation: {
      summary: "Keeps the observations that match a typed clause.",
      use: 'Write the clause as JSON, e.g. {"op":"gt","column":"area","value":100}.',
      note: "`ndea filter` runs the same clause against the running server.",
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const { FilterView } = await import("./view");
      return { mountBody: (host) => mountBody(FilterView, host, "Filter") };
    },
  });
}
