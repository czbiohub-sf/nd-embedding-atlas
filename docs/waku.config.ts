import { defineConfig } from "waku/config";
import tailwindcss from "@tailwindcss/vite";
import press from "fumapress/vite";
import mdx from "fumadocs-mdx/vite";

export default defineConfig({
  // GitHub Pages serves this project site under /nd-embedding-atlas/.
  basePath: "/nd-embedding-atlas/",
  vite: {
    plugins: [press(), mdx(), tailwindcss()],
  },
});
