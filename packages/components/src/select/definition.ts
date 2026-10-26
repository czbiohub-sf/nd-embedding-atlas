/** Select component definition: a pill picker over one column's values. */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";

export interface SelectConfig {
  readonly column: string;
}

export function createSelectDefinition({ mountBody }: { mountBody: BodyMounter }) {
  return defineComponent<SelectConfig>({
    type: "select",
    title: "Select",
    config: {
      schema: z.object({ column: z.string().min(1).meta({ title: "Column", section: "data", control: "column" }) }),
      // No default column: an empty tile never offers it; agents add it with props.
      defaultValue: {} as SelectConfig,
    },
    documentation: {
      summary: "A picker over one column's values, with obs counts.",
      use: "Use it to filter linked views by category: choosing values publishes {op:'in'} into its filter link.",
    },
    binds: ["filter"],
    load: async () => {
      // ComponentDefinition.load is the intentional lazy body boundary: the server reads only the contract.
      const { SelectBody } = await import("./body");
      return { mountBody: (host) => mountBody(SelectBody, host, "Select") };
    },
  });
}
