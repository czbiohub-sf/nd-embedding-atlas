/** Text component definition: a heading or paragraph. */

import { z } from "zod";
import { defineComponent } from "@ndea/sdk";
import type { BodyMounter } from "../contracts";

const VARIANTS = ["heading", "body", "muted"] as const;

export interface TextConfig {
  /** A string, or a `$template` / `$state` expression the host resolves against coordination state before the body reads it. */
  readonly text: string | { readonly $template: string } | { readonly $state: string };
  readonly variant: (typeof VARIANTS)[number];
}

export function createTextDefinition({ mountBody }: { mountBody: BodyMounter }) {
  return defineComponent<TextConfig>({
    type: "text",
    title: "Text",
    config: {
      schema: z.object({
        // ponytail: no generic control for a string-or-expression union; agents and the document set it.
        text: z
          .union([z.string(), z.object({ $template: z.string() }).strict(), z.object({ $state: z.string() }).strict()])
          .meta({ title: "Text", hidden: true }),
        variant: z.enum(VARIANTS).meta({ title: "Style" }),
      }),
      // No default text: an empty tile never offers it; agents add it with props.
      defaultValue: { variant: "body" } as TextConfig,
    },
    documentation: {
      summary: "A heading or paragraph.",
      use: "Use it to label a layout; `text` may be a {$template} or {$state} over coordination state.",
    },
    binds: [],
    load: async () => {
      // ComponentDefinition.load is the intentional lazy body boundary: the server reads only the contract.
      const { TextBody } = await import("./body");
      return { mountBody: (host) => mountBody(TextBody, host, "Text") };
    },
  });
}
