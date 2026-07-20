import { defineConfig } from "waku/config";
import tailwindcss from "@tailwindcss/vite";
import press from "fumapress/vite";
import mdx from "fumadocs-mdx/vite";

const siteBaseUrl = new URL(process.env.DOCS_BASE_URL ?? "https://czbiohub-sf.github.io/nd-embedding-atlas/");
if (!siteBaseUrl.pathname.endsWith("/")) siteBaseUrl.pathname += "/";

export default defineConfig({
  basePath: siteBaseUrl.pathname,
  vite: {
    plugins: [press(), mdx(), tailwindcss()],
  },
});
