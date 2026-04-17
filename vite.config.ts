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

    // Explicitly list ALL plugins — setting "plugins" overwrites the default set.
    // React/react-perf rules only fire on JSX-bearing files, so they're safe to
    // enable globally (no noise on backend .ts).
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "react-perf", "import"],

    // JS plugins (alpha) — ESLint plugins loaded by Oxlint. Required for
    // TypeGPU `'use gpu'` rules (no Rust port).
    jsPlugins: ["eslint-plugin-typegpu"],

    env: {
      browser: true,
      builtin: true,
    },

    settings: {
      react: { version: "19.0.0" },
    },

    ignorePatterns: ["dist/**", "node_modules/**", "src/frontend/components/ui/**"],

    categories: {
      correctness: "error",
      suspicious: "warn",
    },

    rules: {
      // CORRECTNESS
      "no-unused-vars": "off",
      "typescript/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // REACT HOOKS
      "react/rules-of-hooks": "error",
      "react/exhaustive-deps": "warn",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "react/iframe-missing-sandbox": "error",

      // TYPE SAFETY
      "@typescript-eslint/no-explicit-any": "warn",
      "typescript/consistent-type-imports": ["warn", { prefer: "type-imports", fixStyle: "separate-type-imports" }],
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/return-await": "error",
      "typescript/only-throw-error": "error",
      "typescript/no-deprecated": "error",
      "typescript/no-base-to-string": "error",
      "typescript/no-misused-spread": "error",
      "typescript/no-array-delete": "error",
      "typescript/no-unsafe-enum-comparison": "error",
      "typescript/no-unsafe-function-type": "error",
      "typescript/no-non-null-asserted-nullish-coalescing": "error",
      "typescript/no-non-null-asserted-optional-chain": "error",
      "typescript/no-duplicate-type-constituents": "error",
      "typescript/no-redundant-type-constituents": "error",
      "typescript/no-import-type-side-effects": "error",
      "typescript/no-unnecessary-template-expression": "warn",
      "typescript/prefer-find": "warn",
      "typescript/no-confusing-non-null-assertion": "error",
      "typescript/no-duplicate-enum-values": "error",
      "typescript/no-unnecessary-type-conversion": "warn",
      "typescript/use-unknown-in-catch-callback-variable": "error",

      // TS MODERNIZATION
      "typescript/prefer-nullish-coalescing": "warn",
      "typescript/prefer-optional-chain": "warn",
      "typescript/no-wrapper-object-types": "error",
      "typescript/no-empty-object-type": "warn",
      "typescript/ban-ts-comment": [
        "warn",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],
      "typescript/prefer-as-const": "warn",
      "typescript/no-unnecessary-type-assertion": "warn",

      // STYLE
      "prefer-const": "error",
      "no-console": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "no-eval": "error",
      "no-unsafe-finally": "error",
      "no-loop-func": "error",
      "no-useless-catch": "error",
      "no-duplicate-case": "error",

      // UNICORN
      "unicorn/prefer-includes": "warn",
      "unicorn/prefer-string-starts-ends-with": "warn",
      "unicorn/prefer-array-flat-map": "warn",
      "unicorn/prefer-negative-index": "warn",
      "unicorn/prefer-array-find": "warn",
      "unicorn/prefer-type-error": "warn",
      "unicorn/no-useless-undefined": "warn",
      "unicorn/no-null": "off",
      "unicorn/no-array-for-each": "off",

      // REACT PERFORMANCE — disabled (too many false positives on stable refs)
      "react-perf/jsx-no-new-array-as-prop": "off",
      "react-perf/jsx-no-new-object-as-prop": "off",
      "react-perf/jsx-no-new-function-as-prop": "off",
      "react-perf/jsx-no-jsx-as-prop": "off",

      // OXC
      "oxc/no-accumulating-spread": "error",
      "oxc/bad-comparison-sequence": "error",
      "oxc/missing-throw": "error",
      "oxc/bad-object-literal-comparison": "error",
      "oxc/bad-char-at-comparison": "error",
      "oxc/bad-min-max-func": "error",
      "oxc/const-comparisons": "error",
      "oxc/double-comparisons": "warn",
      "oxc/erasing-op": "warn",
      "oxc/only-used-in-recursion": "warn",

      // IMPORT HYGIENE
      "import/no-duplicates": "error",
      "import/no-self-import": "error",
      "import/no-cycle": "warn",

      // TYPEGPU (JS plugin) — WGSL-correctness rules for `'use gpu'` functions.
      "typegpu/no-integer-division": "warn",
      "typegpu/no-math": "warn",
      "typegpu/no-uninitialized-variables": "error",
      "typegpu/no-unwrapped-objects": "error",
      "typegpu/no-invalid-assignment": "error",

      // REACT JSX STYLE
      "react/jsx-fragments": ["warn", "syntax"],
      "react/jsx-boolean-value": ["warn", "never"],
      "react/no-unknown-property": "error",
      "react/no-danger": "warn",
      "react/react-in-jsx-scope": "off",
      "react/jsx-no-target-blank": "error",
      "react/jsx-key": ["error", { checkFragmentShorthand: true }],

      // TS BUG CATCHERS
      "typescript/no-for-in-array": "error",
      "typescript/consistent-type-assertions": ["warn", { assertionStyle: "as" }],

      // ASYNC CORRECTNESS
      "require-await": "error",
      "no-promise-executor-return": "error",

      // MODERNIZATION
      "prefer-template": "warn",
      "react/self-closing-comp": ["warn", { html: false }],
      "typescript/array-type": ["warn", { default: "array" }],
      "typescript/unbound-method": "off",
      "typescript/no-unsafe-type-assertion": "off",
    },

    overrides: [
      {
        // TypeGPU opaque APIs + GPU handle non-null assertions
        files: ["src/frontend/scatter-gpu/**/*.ts", "src/frontend/scatter-gpu/**/*.tsx"],
        rules: {
          "typescript/no-non-null-assertion": "off",
          "@typescript-eslint/no-explicit-any": "off",
          "typescript/no-floating-promises": "warn",
        },
      },
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
        rules: {
          "@typescript-eslint/no-explicit-any": "off",
          "typescript/no-non-null-assertion": "off",
          "typescript/no-floating-promises": "off",
        },
      },
      {
        // scripts/* are one-off dev tools using bun:test or top-level await.
        // bun:test's expect(...).rejects.toThrow() is thenable at runtime but
        // typescript-eslint can't see it as a Promise via its types.
        files: ["scripts/**/*.ts"],
        rules: {
          "typescript/await-thenable": "off",
          "require-await": "off",
        },
      },
      {
        // Dedicated Worker globals — `self` is a DedicatedWorkerGlobalScope,
        // so postMessage takes no targetOrigin and async event listeners are fine.
        // parallel-reader.ts calls worker.postMessage (also no targetOrigin needed
        // for dedicated workers from the main thread).
        files: ["src/zarr/column-worker.ts", "src/zarr/parallel-reader.ts"],
        rules: {
          "unicorn/require-post-message-target-origin": "off",
          "unicorn/prefer-add-event-listener": "off",
          "typescript/no-misused-promises": "off",
        },
      },
    ],
  },

  // ── Oxfmt ──────────────────────────────────────────────────────────────────
  fmt: {
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: false,
    jsxSingleQuote: false,
    trailingComma: "all",
    arrowParens: "always",
    bracketSpacing: true,
    endOfLine: "lf",
    sortPackageJson: true,
  },

  // ── Pre-commit (staged files only) ────────────────────────────────────────
  staged: {
    "src/**": "vp check --fix",
  },

  // ── Vite bundler (frontend) ───────────────────────────────────────────────
  plugins: [react(), tailwindcss(), typegpuPlugin({})],
  resolve: {
    alias: { "@": new URL("./src/frontend", import.meta.url).pathname },
  },
  server: {
    proxy: {
      "/data": "http://localhost:5055",
      "/api": "http://localhost:5055",
      "/plate": "http://localhost:5055",
      "/ws": { target: "ws://localhost:5055", ws: true },
    },
  },
  optimizeDeps: { exclude: ["roaring-wasm"] },
  build: {
    target: "esnext",
    outDir: "dist/frontend",
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
  },
});
