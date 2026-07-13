import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpuPlugin from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";
import { devConsoleEcho } from "./scripts/dev-console-echo.ts";
import { devErrorReporter } from "./scripts/dev-error-reporter.ts";

export default defineConfig({
  run: {
    tasks: {
      "dev:all": {
        dependsOn: ["dev:backend", "dev:frontend"],
        command: "true",
        cache: false,
      },
      "dev:backend": {
        command: "bun --hot run src/cli/index.ts",
        cache: false,
      },
      "dev:frontend": {
        command: "vp dev",
        cache: false,
      },
    },
  },
  plugins: [react(), tailwindcss(), typegpuPlugin({}), devErrorReporter(), devConsoleEcho()],
  resolve: {
    alias: { "@": new URL("./src/frontend", import.meta.url).pathname },
  },
  server: {
    open: true,
    proxy: {
      "/data": "http://localhost:5055",
      "/api": "http://localhost:5055",
      "/plugins": "http://localhost:5055",
      "/plate": "http://localhost:5055",
      "/ws": { target: "ws://localhost:5055", ws: true },
      "/mosaic": { target: "ws://localhost:5055", ws: true },
    },
  },
  optimizeDeps: { exclude: ["roaring-wasm"] },
});
