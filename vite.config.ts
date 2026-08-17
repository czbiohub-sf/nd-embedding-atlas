import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },

    // Setting plugins replaces the default set.
    plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "import"],

    // TypeGPU rules have no native Oxlint port.
    jsPlugins: ["eslint-plugin-typegpu"],

    env: {
      builtin: true,
    },

    settings: {
      react: { version: "19.0.0" },
    },

    ignorePatterns: [
      "**/dist/**",
      "packages/ochre/src/colormap/data/**",
      // Generated Bunli metadata contains raw AST nodes.
      ".bunli/**",
    ],

    categories: {
      correctness: "error",
      suspicious: "warn",
    },

    rules: {
      "no-unused-vars": "off",
      "typescript/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],

      "typescript/no-explicit-any": "warn",
      "typescript/consistent-type-imports": ["warn", { prefer: "type-imports", fixStyle: "separate-type-imports" }],
      "typescript/no-deprecated": "error",
      "typescript/switch-exhaustiveness-check": [
        "warn",
        {
          considerDefaultExhaustiveForUnions: true,
        },
      ],
      "typescript/prefer-nullish-coalescing": "warn",
      "typescript/prefer-optional-chain": "warn",
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
      "typescript/consistent-type-assertions": ["warn", { assertionStyle: "as" }],
      "typescript/array-type": ["warn", { default: "array" }],
      "typescript/unbound-method": "off",
      "typescript/no-unsafe-type-assertion": "off",
      // React effects may return cleanup functions conditionally.
      "typescript/consistent-return": "off",

      "no-console": "off",
      // Used by private fields, math shorthands, and exhaustiveness guards.
      "no-underscore-dangle": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],

      "unicorn/prefer-includes": "warn",
      "unicorn/prefer-string-starts-ends-with": "warn",
      "unicorn/prefer-array-flat-map": "warn",
      "unicorn/prefer-negative-index": "warn",
      "unicorn/prefer-array-find": "warn",
      "unicorn/prefer-type-error": "warn",
      "unicorn/no-useless-undefined": "warn",
      "unicorn/no-null": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/filename-case": [
        "error",
        {
          cases: {
            kebabCase: true,
            pascalCase: true,
          },
          ignore: ["^use[A-Z]"],
        },
      ],

      "import/no-cycle": "warn",
      "typegpu/no-integer-division": "warn",
      "typegpu/no-math": "warn",
      "typegpu/no-uninitialized-variables": "error",
      "typegpu/no-unwrapped-objects": "error",
      "typegpu/no-invalid-assignment": "error",

      "react/jsx-fragments": ["warn", "syntax"],
      "react/jsx-boolean-value": ["warn", "never"],
      "react/no-danger": "warn",
      "react/react-in-jsx-scope": "off",
      "prefer-template": "warn",
      "react/self-closing-comp": ["warn", { html: false }],
    },

    overrides: [
      {
        files: ["**/src/frontend/**/*.{ts,tsx}", "docs/**/*.{ts,tsx}", "examples/plugins/**/*.{ts,tsx}"],
        env: {
          browser: true,
        },
      },
      {
        // These modules co-locate components with constants or helpers.
        files: [
          "**/src/frontend/components/node-workspace/**/*.tsx",
          "**/src/frontend/components/ui/**/*.tsx",
          "packages/ui/src/components/**/*.tsx",
          "**/src/frontend/core/workspace/**/*.tsx",
          "docs/press.config.tsx",
        ],
        rules: {
          "react/only-export-components": "off",
        },
      },
      {
        // shadcn components preserve upstream fallback expressions.
        files: ["**/src/frontend/components/ui/**/*.tsx", "packages/ui/src/components/**/*.tsx"],
        rules: {
          "typescript/prefer-nullish-coalescing": "off",
        },
      },
      {
        // TanStack Table cell callbacks render values; they are not nested components.
        files: ["packages/nodes/src/table/DataTable.tsx"],
        rules: {
          "react/no-unstable-nested-components": "off",
        },
      },
      {
        // TypeGPU exposes opaque APIs and nullable GPU handles.
        files: ["packages/nodes/src/scatter/gpu/**/*.{ts,tsx}"],
        rules: {
          "typescript/no-non-null-assertion": "off",
          "typescript/no-explicit-any": "off",
          "typescript/no-floating-promises": "warn",
        },
      },
      {
        files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
        rules: {
          "typescript/no-explicit-any": "off",
          "typescript/no-non-null-assertion": "off",
          "typescript/no-floating-promises": "off",
          // `bun:test` exposes `expect(...).rejects` as a runtime thenable.
          "typescript/await-thenable": "off",
        },
      },
      {
        files: ["apps/ndea/scripts/**/*.ts", "scripts/**/*.ts"],
        rules: {
          "typescript/await-thenable": "off",
        },
      },
      {
        // Worker postMessage takes no targetOrigin.
        files: [
          "**/src/column-worker.ts",
          "**/src/readers.ts",
          "**/src/server/crop-pool.ts",
          "**/src/server/crop-worker.ts",
        ],
        rules: {
          "unicorn/require-post-message-target-origin": "off",
          "unicorn/prefer-add-event-listener": "off",
          "typescript/no-misused-promises": "off",
        },
      },
      {
        files: ["packages/**/*.{ts,tsx}"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["@/**", "**/apps/ndea/**"],
                  message: "Workspace packages cannot import app implementation paths.",
                },
              ],
            },
          ],
        },
      },
      {
        // Node specs co-locate definitions and components.
        files: ["apps/ndea/src/frontend/core/node/native-contributions/**/*.tsx", "packages/nodes/src/**/*.tsx"],
        rules: { "react/only-export-components": "off" },
      },
    ],
  },

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
    // Generated metadata and packed colormap tables must retain source layout.
    ignorePatterns: [".bunli/**", "**/dist/**", "packages/ochre/src/colormap/data/**"],
  },

  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs,json,jsonc,md,mdx,css,yaml,yml}": "vp check --fix",
  },
});
