import { localMd } from "@fumadocs/satteri/local-md";
import { watchWithVite } from "@fumadocs/satteri/local-md/dev/vite";
import {
  blogMetaSchema,
  blogPageSchema,
} from "fumapress/adapters/mdx/schema";
import z from "zod";
import { biohubCodeThemes } from "./code-theme";

export const blogSource = localMd({
  dir: "blog",
  // The blog compiles through Sätteri rather than the MDX pipeline, so it needs
  // the same syntax theme wired separately or code blocks fall back to Shiki's.
  satteriOptions: {
    rehypeCodeOptions: {
      themes: biohubCodeThemes,
    },
  },
  // `date` is required on purpose. Fumapress falls back to the build time when
  // a post has no creation date, which silently re-dates every post on each
  // deploy and drops it from the RSS feed, so a missing date must fail loudly.
  frontmatterSchema: blogPageSchema.extend({
    // A date-only value parses to UTC midnight, which renders as the previous
    // day for readers behind UTC. Anchor those at midday so the published date
    // survives formatting in every timezone; explicit times are left alone.
    date: z.coerce
      .date()
      .transform((value) =>
        value.getTime() % 86_400_000 === 0
          ? new Date(value.getTime() + 43_200_000)
          : value,
      ),
  }),
  metaSchema: blogMetaSchema,
});

if (import.meta.env.DEV) {
  watchWithVite(blogSource);
}
