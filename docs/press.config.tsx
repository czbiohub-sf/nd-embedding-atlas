import { defineConfig } from "fumapress";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { docs } from "./.source/server";

export default defineConfig({
  content: docs.toFumadocsSource(),
  site: {
    name: "nd-embedding-atlas",
    baseUrl: "https://czbiohub-sf.github.io/nd-embedding-atlas/",
    git: {
      user: "czbiohub-sf",
      repo: "nd-embedding-atlas",
      branch: "main",
      rootDir: "docs/content",
    },
  },
})
  .plugins(flexsearchPlugin(), llmsPlugin())
  .adapters(fumadocsMdx());
