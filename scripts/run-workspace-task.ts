#!/usr/bin/env bun

import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const [packageName, task, ...taskArgs] = Bun.argv.slice(2);

if (!packageName || !task) {
  console.error("Usage: bun run scripts/run-workspace-task.ts <package-name> <task> [args...]");
  process.exit(2);
}

const manifests: { name: string; path: string }[] = [];
for (const parent of ["apps", "packages"]) {
  const glob = new Bun.Glob("*/package.json");
  for await (const path of glob.scan({ cwd: resolve(ROOT, parent), onlyFiles: true })) {
    const manifestPath = resolve(ROOT, parent, path);
    const manifest = (await Bun.file(manifestPath).json()) as { name?: unknown };
    if (typeof manifest.name === "string") manifests.push({ name: manifest.name, path: manifestPath });
  }
}

const matches = manifests.filter((manifest) => manifest.name === packageName);
if (matches.length !== 1) {
  const found = matches.length === 0 ? "none" : matches.map((match) => match.path).join(", ");
  console.error(`Expected exactly one workspace named ${packageName}; found ${found}.`);
  process.exit(1);
}

const args = ["vp", "run", "--filter", packageName, task];
if (taskArgs.length > 0) args.push("--", ...taskArgs);

const child = Bun.spawn(args, {
  cwd: ROOT,
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
