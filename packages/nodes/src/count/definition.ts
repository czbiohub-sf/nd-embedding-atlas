import { defineNode, exactNodeTypeRef } from "@ndea/sdk";
import type { NodeBodyMounter } from "../contracts";
import type { CountCapabilities, CountPredicateToSql } from "./contracts";
import { createCountBody } from "./body";

export function createCountDefinition({
  mountBody,
  predicateToSql,
}: {
  mountBody: NodeBodyMounter;
  predicateToSql: CountPredicateToSql;
}) {
  return defineNode({
    ref: exactNodeTypeRef("count", "1.0.0"),
    title: "Count",
    role: "view",
    inputs: [{ id: "in", kind: "pred", label: "In" }],
    outputs: [],
    capabilities: ["data-read"] satisfies readonly CountCapabilities[],
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const CountBody = createCountBody(predicateToSql);
      return { mountBody: (host) => mountBody(CountBody, host, "Count") };
    },
  });
}
