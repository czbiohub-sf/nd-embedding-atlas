import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import typegpuPlugin from "unplugin-typegpu/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
    // ── Oxlint ────────────────────────────────────────────────────────────────
    lint: {
        // ── vp options ──────────────────────────────────────────────────────────
        options: {
            typeAware: true,
            typeCheck: true,
        },

        // ── Plugins ─────────────────────────────────────────────────────────────
        // Explicitly list ALL plugins — setting "plugins" overwrites the default set.
        plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "react-perf", "import"],

        // ── Environment globals ──────────────────────────────────────────────────
        env: {
            browser: true,
            es2022: true,
        },

        // ── Plugin-wide settings ─────────────────────────────────────────────────
        settings: {
            react: { version: "19.0.0" },
        },

        // ── Ignore patterns ──────────────────────────────────────────────────────
        ignorePatterns: ["dist/**", "node_modules/**", "src/components/ui/**"],

        // ── Category defaults ────────────────────────────────────────────────────
        categories: {
            correctness: "error",
            suspicious: "warn",
        },

        // ── Per-rule overrides ───────────────────────────────────────────────────
        rules: {
            // CORRECTNESS
            // Defer to typescript/no_unused_vars which handles TS symbols correctly
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
            "react/exhaustive-deps": "warn", // warn not error — auto-fixer rewrites intentional dep arrays
            "react/only-export-components": ["warn", { allowConstantExport: true }],

            // TYPE SAFETY (ruff B + TRY)
            "@typescript-eslint/no-explicit-any": "warn", // TypeGPU uses complex inference; see scatter-gpu/ override
            "typescript/consistent-type-imports": [
                "warn",
                { prefer: "type-imports", fixStyle: "separate-type-imports" },
            ],
            "typescript/no-floating-promises": "error",
            "typescript/no-misused-promises": "error",
            "typescript/return-await": "error",
            "typescript/only-throw-error": "error",

            // TYPESCRIPT MODERNIZATION (ruff UP)
            "typescript/prefer-nullish-coalescing": "warn",
            "typescript/prefer-optional-chain": "warn", // auto-fix can change semantics on falsy short-circuits
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

            // STYLE (ruff E, W)
            "prefer-const": "error",
            "no-console": "off",
            eqeqeq: ["error", "always", { null: "ignore" }], // allow == null (checks both null + undefined)
            "no-var": "error",
            "no-eval": "error",
            "no-unsafe-finally": "error", // ruff B012
            "no-loop-func": "error", // ruff B023
            "no-useless-catch": "error", // ruff TRY200/TRY201
            "no-duplicate-case": "error", // ruff B025

            // UNICORN MODERNIZATION (ruff C4 + UP + PERF)
            "unicorn/prefer-includes": "warn",
            "unicorn/prefer-string-starts-ends-with": "warn",
            "unicorn/prefer-array-flat-map": "warn",
            "unicorn/prefer-negative-index": "warn",
            "unicorn/prefer-array-find": "warn",
            "unicorn/prefer-type-error": "warn", // ruff TRY004
            "unicorn/no-useless-undefined": "warn",
            "unicorn/no-null": "off", // null used extensively for React refs and DuckDB nullable columns
            "unicorn/no-array-for-each": "off", // .forEach() is idiomatic in TanStack callbacks

            // REACT PERFORMANCE (ruff PERF for React)
            "react-perf/jsx-no-new-array-as-prop": "off",
            "react-perf/jsx-no-new-object-as-prop": "off",
            "react-perf/jsx-no-new-function-as-prop": "off",
            "react-perf/jsx-no-jsx-as-prop": "off",

            // OXC-SPECIFIC (ruff B + PERF)
            "oxc/no-accumulating-spread": "error", // O(n²) spread in reduce — critical for Mosaic pipelines
            "oxc/bad-comparison-sequence": "error",
            "oxc/missing-throw": "error",

            // IMPORT HYGIENE (ruff I + TID)
            "import/no-duplicates": "error",
            "import/no-self-import": "error",
            "import/no-cycle": "warn", // warn only — can be slow

            // REACT JSX STYLE
            "react/jsx-fragments": ["warn", "syntax"],
            "react/jsx-boolean-value": ["warn", "never"],
            "react/no-unknown-property": "error",
            "react/no-danger": "warn",
            "react/react-in-jsx-scope": "off", // React 19 new JSX transform — no import needed
            "react/jsx-no-target-blank": "error",
            "react/jsx-key": ["error", { checkFragmentShorthand: true }],

            // ════════════════════════════════════════════════════════════════════════
            // ADDITIONAL BUG CATCHERS
            // ════════════════════════════════════════════════════════════════════════

            // OXC bug catchers
            "oxc/bad-object-literal-comparison": "error", // obj === {} always false
            "oxc/bad-char-at-comparison": "error", // str.charAt(0) === "ab" always false
            "oxc/bad-min-max-func": "error", // Math.min(a, Math.max(a, b)) patterns
            "oxc/const-comparisons": "error", // comparisons always true/false
            "oxc/double-comparisons": "warn", // x > 0 && x >= 0 redundancies
            "oxc/erasing-op": "warn", // x | 0 and similar no-op patterns
            "oxc/only-used-in-recursion": "warn", // params only used in recursive calls

            // TypeScript bug catchers
            "typescript/no-for-in-array": "error", // for...in on arrays — use for...of
            "typescript/consistent-type-assertions": ["warn", { assertionStyle: "as" }],

            // ESLint async correctness
            "require-await": "error", // async functions that never await
            "no-promise-executor-return": "error", // return inside new Promise executor

            // Modernization
            "prefer-template": "warn", // "hello " + name → `hello ${name}`
            "react/self-closing-comp": ["warn", { html: false }], // <Foo></Foo> → <Foo />
            "typescript/array-type": ["warn", { default: "array" }], // enforce T[] over Array<T>
            // OFF: false positives on destructured React/TanStack hook methods
            "typescript/unbound-method": "off",
            "typescript/no-unsafe-type-assertion": "off", // intentional assertions throughout (GPU handles, Mosaic types)
        },

        // ── File-scoped overrides ────────────────────────────────────────────────
        overrides: [
            {
                // scatter-gpu/ uses non-null assertions for GPU device handles and any
                // types for TypeGPU opaque APIs — relax both
                files: ["src/scatter-gpu/**/*.ts", "src/scatter-gpu/**/*.tsx"],
                rules: {
                    "typescript/no-non-null-assertion": "off",
                    "@typescript-eslint/no-explicit-any": "off",
                    "typescript/no-floating-promises": "warn", // GPU pipelines use bare Promise chains
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
        "*.{ts,tsx,js,jsx}": "vp fmt --write",
        "*.{json,css}": "vp fmt --write",
    },

    // ── Task runner ───────────────────────────────────────────────────────────
    // vp run <task> or vp run <task>
    // Tasks defined here are cached by default; package.json scripts are not.
    run: {
        tasks: {
            // Format source — always cache: false (mutates files)
            fmt: {
                command: "vp fmt --write src",
                cache: false,
            },

            // Lint — format first so linter sees canonical code, not style noise
            lint: {
                command: "vp lint --deny-warnings src",
                dependsOn: ["fmt"],
            },

            // Full quality gate: fmt → lint → typecheck
            // vp check handles typecheck internally via tsgolint
            check: {
                command: "vp check",
                cache: false,
            },

            // Build — only after quality gate passes
            build: {
                command: "vp build",
                dependsOn: ["check"],
                env: ["NODE_ENV"],
            },
        },
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
                codeSplitting: true,
            },
        },
    },
});
