/**
 * bunli.config.ts: configuration for the bunli toolchain.
 *
 * We do NOT use `bunli build` for releases (our pipeline goes through
 * apps/ndea/scripts/build.ts + GitHub Actions to handle frontend asset embedding
 * + per-platform native compile). This config exists for `bunli generate`,
 * which produces `.bunli/commands.gen.ts`: the command-tree metadata
 * consumed by `@bunli/plugin-completions` to render shell completions.
 *
 * Run after every command-surface change:
 *
 *   vp run gen
 *
 * Output is committed so completions stay in sync with source without
 * runtime regeneration; CI verifies via .github/scripts/check-bunli-gen.sh.
 */

import { defineConfig, type BunliConfigInput } from "@bunli/core";

// `version` deliberately omitted: bunli reads it for `bunli release` /
// `bunli build`, neither of which we use (release is GitHub Actions +
// the app builder). The user-visible `ndea --version` reads from
// `apps/ndea/src/cli/version.ts`, which the app's sync-version task keeps in
// lock-step with `apps/ndea/package.json`.
const config: BunliConfigInput = {
  name: "ndea",
  description: "Interactive browser-based dashboard linking AI embeddings to source 5D image data.",
  commands: {
    entry: "./apps/ndea/src/cli/index.ts",
    directory: "./apps/ndea/src/cli/commands",
  },
};

export default defineConfig(config);
