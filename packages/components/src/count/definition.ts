import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";
import { CountBody } from "./body";

export function createCountDefinition({ mountBody }: { mountBody: BodyMounter }) {
  return defineComponent({
    type: "count",
    title: "Count",
    documentation: {
      summary: "Shows the live number of rows its data and filter scope select.",
      use: "Use it as a metric that updates as other views filter the data.",
    },
    binds: ["filter"],
    load: async () => ({ mountBody: (host) => mountBody(CountBody, host, "Count") }),
  });
}
