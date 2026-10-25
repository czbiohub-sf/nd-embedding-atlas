#!/usr/bin/env bun

/**
 * Build duckdb.node with DuckDB statically linked (macOS arm64 only).
 *
 * The npm `@duckdb/node-bindings-<platform>` addon links `@rpath/libduckdb`,
 * which the compiled binary would have to extract and dlopen at runtime.
 * Linking DuckDB's release static libs into the addon removes that file.
 *
 * Inputs, all pinned by the installed `@duckdb/node-bindings` version:
 *   - duckdb-node-neo `bindings/src` at tag `v<bindings version>`
 *   - the DuckDB release that tag's `fetch_libduckdb.py` downloads, as
 *     `duckdb-static-libs-osx-arm64.tar.gz`
 *   - node-addon-api + node-api-headers (devDependencies)
 *
 * Output is cached at apps/ndea/.duckdb-addon-cache/<bindings version>/duckdb.node.
 *
 * Usage: bun run scripts/build-duckdb-addon.ts   (prints the addon path)
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const APP_ROOT = resolve(import.meta.dir, "..");

async function run(cmd: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`Command failed: ${cmd.join(" ")}`);
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  await Bun.write(dest, res);
}

/** Absolute path to a statically linked duckdb.node, building it on first call. */
export async function buildStaticDuckDBAddon(): Promise<string> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("Static DuckDB addon is only implemented for darwin-arm64");
  }

  const nodeApiDir = dirname(Bun.resolveSync("@duckdb/node-api/package.json", APP_ROOT));
  const bindingsVersion: string = (
    await Bun.file(Bun.resolveSync("@duckdb/node-bindings/package.json", nodeApiDir)).json()
  ).version;
  const cacheDir = resolve(APP_ROOT, ".duckdb-addon-cache", bindingsVersion);
  const addon = resolve(cacheDir, "duckdb.node");
  if (existsSync(addon)) return addon;

  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });

  // duckdb-node-neo bindings source at the tag matching the npm package.
  const tag = `v${bindingsVersion}`;
  const tarball = resolve(cacheDir, "neo.tar.gz");
  await download(`https://codeload.github.com/duckdb/duckdb-node-neo/tar.gz/refs/tags/${tag}`, tarball);
  await run(["tar", "-xzf", tarball, "--strip-components=2", "*/bindings/src", "*/bindings/scripts"], cacheDir);

  // The bindings' shared fetch script pins the DuckDB release they were built against.
  const fetchScript = await Bun.file(resolve(cacheDir, "scripts/fetch_libduckdb.py")).text();
  const duckdbVersion = fetchScript.match(/releases\/download\/(v[\d.]+)/)?.[1];
  if (!duckdbVersion) throw new Error("Could not find the DuckDB version in fetch_libduckdb.py");

  const libsDir = resolve(cacheDir, "libs");
  const tgz = resolve(cacheDir, "static-libs.tar.gz");
  await download(
    `https://github.com/duckdb/duckdb/releases/download/${duckdbVersion}/duckdb-static-libs-osx-arm64.tar.gz`,
    tgz,
  );
  mkdirSync(libsDir, { recursive: true });
  await run(["tar", "-xzf", tgz, "-C", libsDir]);
  // ld64 resolves across all archives regardless of order; unreferenced
  // members (tpch/tpcds, which the generated loader doesn't reference) drop out.
  const archives = readdirSync(libsDir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".a"))
    .map((f) => resolve(libsDir, f));

  const nodeAddonApi = dirname(Bun.resolveSync("node-addon-api/package.json", APP_ROOT));
  const nodeApiHeaders = dirname(Bun.resolveSync("node-api-headers/package.json", APP_ROOT));
  const cmd = [
    "clang++",
    "-std=c++17",
    "-O2",
    "-arch",
    "arm64",
    "-mmacosx-version-min=11.0",
    "-fPIC",
    "-fexceptions",
    "-fvisibility=hidden",
    // binding.gyp's `node_addon_api_except_all` + node-gyp's addon defines.
    "-DNAPI_CPP_EXCEPTIONS",
    "-DNODE_ADDON_API_CPP_EXCEPTIONS_ALL",
    "-DBUILDING_NODE_EXTENSION",
    "-DNODE_GYP_MODULE_NAME=duckdb",
    `-I${resolve(cacheDir, "src")}`,
    `-I${libsDir}`,
    `-I${nodeAddonApi}`,
    `-I${resolve(nodeApiHeaders, "include")}`,
    resolve(cacheDir, "src/duckdb_node_bindings.cpp"),
    ...archives,
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-Wl,-dead_strip",
    "-o",
    `${addon}.tmp`,
  ];
  console.log(`  Compiling static duckdb.node (DuckDB ${duckdbVersion}, bindings ${tag})...`);
  await run(cmd);
  await run(["strip", "-x", `${addon}.tmp`]);
  await run(["mv", `${addon}.tmp`, addon]);
  return addon;
}

if (import.meta.main) console.log(await buildStaticDuckDBAddon());
