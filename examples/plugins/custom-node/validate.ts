import { resolve } from "node:path";
import { buildCustomNodePlugin } from "./build";

const PLUGIN_ROOT = import.meta.dir;
const APP_ROOT = resolve(PLUGIN_ROOT, "../../../apps/ndea");

export async function validateCustomNodePlugin(): Promise<number> {
  await buildCustomNodePlugin();
  const process = Bun.spawn(["bun", "run", "src/cli/index.ts", "plugin", "validate", PLUGIN_ROOT], {
    cwd: APP_ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env, NDEA_DISABLE_AUTOUPDATER: "1" },
  });
  return process.exited;
}

if (import.meta.main) process.exit(await validateCustomNodePlugin());
