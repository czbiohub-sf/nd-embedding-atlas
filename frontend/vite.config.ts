import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpuPlugin from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // ── Oxlint ────────────────────────────────────────────────────────────────
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  // ── Oxfmt ──────────────────────────────────────────────────────────────────
  fmt: {
    printWidth: 120,        // matches Python ruff 120-char convention
    tabWidth: 2,            // project standard (CLAUDE.md)
    useTabs: false,
    semi: true,             // always semicolons
    singleQuote: false,     // double quotes everywhere
    jsxSingleQuote: false,
    trailingComma: "all",   // ES2017+ compatible
    arrowParens: "always",  // required for TS type annotations on params
    bracketSpacing: true,   // { x } not {x}
    endOfLine: "lf",        // explicit — "auto" is not supported by oxfmt
    sortPackageJson: false, // IMPORTANT: oxfmt sorts package.json by default — disable
  },

  // ── Pre-commit (staged files only) ────────────────────────────────────────
  staged: {
    "*.{ts,tsx,js,jsx}": "vp fmt --write",
    "*.{json,css}": "vp fmt --write",
  },

  // ── Vite ──────────────────────────────────────────────────────────────────
  plugins: [react(), tailwindcss(), typegpuPlugin({})],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  server: {
    proxy: {
      "/data": "http://localhost:5055",
      "/api": "http://localhost:5055",
      "/plate": "http://localhost:5055",
    },
  },
  optimizeDeps: { exclude: ["roaring-wasm"] },
  build: {
    target: "esnext",
    outDir: "dist",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/]+(react|react-dom|scheduler)/,
              priority: 30,
            },
            {
              name: "vendor-typegpu",
              test: /node_modules[\\/]+(typegpu|@typegpu)/,
              priority: 25,
            },
            {
              name: "vendor-mosaic",
              test: /node_modules[\\/]+(@uwdata|mosaic)/,
              priority: 25,
            },
            {
              name: "vendor-dockview",
              test: /node_modules[\\/]+dockview/,
              priority: 25,
            },
            {
              name: "vendor-idetik",
              test: /node_modules[\\/]+@idetik/,
              priority: 20,
            },
            {
              name: "vendor-tanstack",
              test: /node_modules[\\/]+@tanstack/,
              priority: 20,
            },
            {
              name: "vendor-arrow",
              test: /node_modules[\\/]+(apache-arrow)/,
              priority: 15,
            },
            {
              name: "vendor-roaring",
              test: /[\\/]node_modules[\\/]roaring-wasm[\\/]/,
              priority: 15,
            },
            {
              name: "vendor-ui",
              test: /node_modules[\\/]+(lucide-react|@base-ui|class-variance-authority|clsx|tailwind-merge|cmdk|@radix-ui)/,
              priority: 10,
            },
            {
              name: "vendor-misc",
              test: /node_modules[\\/]+(gl-matrix|zod|swr|@zarr|zarr)/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
});
