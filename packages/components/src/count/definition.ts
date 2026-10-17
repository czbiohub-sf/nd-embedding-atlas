import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import type { CountPredicateToSql } from "./contracts";
import { createCountBody } from "./body";

export function createCountDefinition({
  mountBody,
  predicateToSql,
}: {
  mountBody: BodyMounter;
  predicateToSql: CountPredicateToSql;
}) {
  return defineComponent({
    type: "count",
    title: "Count",
    documentation: {
      summary: "Shows the live number of rows its data and filter scope select.",
      use: "Use it as a metric that updates as other views filter the data.",
    },
    binds: ["filter"],
    load: async () => {
      // ComponentDefinition.load is the intentional lazy component-body boundary.
      const CountBody = createCountBody(predicateToSql);
      return { mountBody: (host) => mountBody(CountBody, host, "Count") };
    },
  });
}
