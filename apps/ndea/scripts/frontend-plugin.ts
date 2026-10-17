/**
 * The frontend's one bundler plugin set: Tailwind v4 and the TypeGPU `'use gpu'` transform.
 * Bun's dev server loads it from the root bunfig.toml (`[serve.static] plugins`); build.ts
 * passes it to Bun.build, so dev and production bundle identically.
 */

import type { BunPlugin } from "bun";
import tailwind from "bun-plugin-tailwind";
import typegpu from "unplugin-typegpu/bun";

const plugins = [tailwind, typegpu({})];

export default {
  name: "ndea-frontend",
  async setup(build) {
    for (const plugin of plugins) await plugin.setup(build);
  },
} satisfies BunPlugin;
