import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const PLUGIN_ROOT = import.meta.dir;

export async function buildCustomNodePlugin(outputRoot = PLUGIN_ROOT): Promise<string> {
  const targetRoot = resolve(outputRoot);
  const dist = resolve(targetRoot, "dist");
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve(PLUGIN_ROOT, "src/client.ts")],
    outdir: dist,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "none",
    splitting: false,
  });
  if (!result.success) {
    throw new AggregateError(
      result.logs.map((log) => new Error(log.message)),
      "Custom-node plugin build failed",
    );
  }

  if (targetRoot !== PLUGIN_ROOT) {
    await mkdir(resolve(targetRoot, "assets"), { recursive: true });
    await Promise.all([
      copyFile(resolve(PLUGIN_ROOT, "ndea-plugin.json"), resolve(targetRoot, "ndea-plugin.json")),
      copyFile(resolve(PLUGIN_ROOT, "assets/styles.css"), resolve(targetRoot, "assets/styles.css")),
    ]);
  }
  return targetRoot;
}

function outputRootFromArgs(args: readonly string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith("--outdir="));
  if (inline) return inline.slice("--outdir=".length);
  const index = args.indexOf("--outdir");
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.main) {
  const outputRoot = outputRootFromArgs(Bun.argv.slice(2));
  const target = await buildCustomNodePlugin(outputRoot);
  console.log(`Built custom-node plugin at ${target}`);
}
