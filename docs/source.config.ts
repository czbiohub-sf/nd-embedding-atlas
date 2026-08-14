import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { metaSchema, pageSchema } from "fumapress/adapters/mdx/schema";
import { biohubCodeThemes } from "./src/code-theme";

export const docs = defineDocs({
  dir: "content",
  docs: {
    async: true,
    schema: pageSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    // Shiki's stock palette is the one visibly off-brand surface otherwise.
    rehypeCodeOptions: {
      themes: biohubCodeThemes,
    },
  },
});
