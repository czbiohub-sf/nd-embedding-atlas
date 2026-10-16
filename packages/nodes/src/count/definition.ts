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
    capabilities: ["data-read"] satisfies readonly CountCapabilities[],
    documentation: {
      summary: "Shows the live number of rows its data and filter scope select.",
      use: "Use it as a metric that updates as other views filter the data.",
    },
    load: async () => {
      // NodeDefinition.load is the intentional lazy plugin-module boundary.
      const CountBody = createCountBody(predicateToSql);
      return { mountBody: (host) => mountBody(CountBody, host, "Count") };
    },
  });
}
