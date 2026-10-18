#!/usr/bin/env bun

/**
 * Build the duckdb-zarr DuckDB extension from source for the installed
 * `@duckdb/node-api` (`vp run build:zarr-ext`).
 *
 * duckdb-zarr builds are `C_STRUCT_UNSTABLE`: DuckDB loads one only if it was
 * built for its exact version. So this fetches duckdb-zarr at a pinned commit,
 * pins its duckdb-rs crate to the DuckDB version `@duckdb/node-bindings` ships
 * (`1.5.6` → crate `1.10506.x`), runs `cargo build --release`, and appends the
 * extension metadata footer DuckDB checks on `LOAD` (a port of extension-ci-tools'
 * `append_extension_metadata.py`, so no Python).
 *
 * Output: apps/ndea/.zarr-ext-cache/<extver>-<duckdbver>-<platform>/zarr.duckdb_extension.
 * An existing output is reused without cargo.
 *
 * Usage: bun run scripts/build-zarr-extension.ts   (prints the extension path)
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ZARR_EXTENSION, duckdbPlatform, zarrExtensionKey } from "../src/server/zarr-extension.ts";

const APP_ROOT = resolve(import.meta.dir, "..");
const CACHE = resolve(APP_ROOT, ".zarr-ext-cache");

async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<void> {
  const proc = Bun.spawn(cmd, {
    ...options,
    env: { ...process.env, ...options.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error(`Command failed: ${cmd.join(" ")}`);
}

/** DuckDB version (`v1.5.6`) of the installed `@duckdb/node-bindings` (`1.5.6-r.1`). */
async function installedDuckDBVersion(): Promise<string> {
  const nodeApiDir = dirname(Bun.resolveSync("@duckdb/node-api/package.json", APP_ROOT));
  const bindings: string = (await Bun.file(Bun.resolveSync("@duckdb/node-bindings/package.json", nodeApiDir)).json())
    .version;
  const match = bindings.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unrecognized @duckdb/node-bindings version ${bindings}`);
  return `v${match[1]}.${match[2]}.${match[3]}`;
}

/** duckdb-rs numbers its crate `1.MMmmpp` after the DuckDB release: v1.5.6 → `1.10506`. */
function duckdbRsSeries(duckdbVersion: string): string {
  const [major, minor, patch] = duckdbVersion.slice(1).split(".").map(Number);
  if (major !== 1 || minor > 99 || patch > 99)
    throw new Error(`No duckdb-rs crate mapping for DuckDB ${duckdbVersion}`);
  return `1.${major}${String(minor).padStart(2, "0")}${String(patch).padStart(2, "0")}`;
}

/** extension-ci-tools' metadata footer: 8 × 32-byte fields after a signature marker, then 256 zero bytes. */
function metadataFooter(fields: {
  platform: string;
  duckdbVersion: string;
  extensionVersion: string;
}): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const field = (value: string) => {
    const bytes = new Uint8Array(32);
    bytes.set(encoder.encode(value));
    return bytes;
  };
  const parts = [
    new Uint8Array([0, 147, 4, 16, ...encoder.encode("duckdb_signature"), 128, 4]),
    // FIELD8..FIELD1: three unused, ABI type, extension version, DuckDB version, platform, magic "4".
    ...["", "", "", "C_STRUCT_UNSTABLE", fields.extensionVersion, fields.duckdbVersion, fields.platform, "4"].map(
      field,
    ),
    new Uint8Array(256),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Absolute path to zarr.duckdb_extension for this host, building it on first call. */
export async function buildZarrExtension(): Promise<string> {
  const duckdbVersion = await installedDuckDBVersion();
  const platform = duckdbPlatform();
  const out = resolve(CACHE, zarrExtensionKey(duckdbVersion, platform), "zarr.duckdb_extension");
  if (existsSync(out)) return out;

  if (!Bun.which("cargo")) {
    throw new Error(
      "cargo not found: the duckdb-zarr extension is built from Rust source. Install Rust from https://rustup.rs " +
        "(or `brew install rust`), then rerun `vp run build:zarr-ext`.",
    );
  }

  // Source at the pinned commit; Cargo.toml pinned to the matching duckdb-rs series.
  const src = resolve(CACHE, `src-${ZARR_EXTENSION.version}`);
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const tarball = resolve(CACHE, `${ZARR_EXTENSION.commit}.tar.gz`);
  const res = await fetch(`https://codeload.github.com/xqlsystems/duckdb-zarr/tar.gz/${ZARR_EXTENSION.commit}`);
  if (!res.ok) throw new Error(`Download duckdb-zarr ${ZARR_EXTENSION.commit}: HTTP ${res.status}`);
  await Bun.write(tarball, res);
  await run(["tar", "-xzf", tarball, "--strip-components=1", "-C", src]);
  rmSync(tarball);

  const series = duckdbRsSeries(duckdbVersion);
  const manifest = resolve(src, "Cargo.toml");
  const cargoToml = await Bun.file(manifest).text();
  const pinned = cargoToml.replace(/^duckdb = \{ version = "=[^"]+"/m, `duckdb = { version = "~${series}.0"`);
  if (pinned === cargoToml)
    throw new Error(`duckdb-zarr ${ZARR_EXTENSION.version}: no \`duckdb = { version = "=…"\` in Cargo.toml`);
  await Bun.write(manifest, pinned);

  console.log(`  Building duckdb-zarr ${ZARR_EXTENSION.version} for DuckDB ${duckdbVersion} (${platform})...`);
  // cwd = the source tree, so its .cargo/config.toml (macOS SDK flags, static CRT on Windows) applies.
  try {
    await run(["cargo", "update", "--package", "duckdb", "--package", "libduckdb-sys"], { cwd: src });
  } catch (error) {
    throw new Error(`No duckdb-rs ${series}.x on crates.io for DuckDB ${duckdbVersion}: ${String(error)}`, {
      cause: error,
    });
  }
  const target = resolve(CACHE, "target");
  await run(["cargo", "build", "--release", "--locked"], {
    cwd: src,
    env: {
      CARGO_TARGET_DIR: target,
      DUCKDB_EXTENSION_NAME: "zarr",
      DUCKDB_EXTENSION_MIN_DUCKDB_VERSION: duckdbVersion,
    },
  });

  const library = resolve(
    target,
    "release",
    process.platform === "win32" ? "zarr.dll" : process.platform === "darwin" ? "libzarr.dylib" : "libzarr.so",
  );
  const footer = metadataFooter({ platform, duckdbVersion, extensionVersion: ZARR_EXTENSION.version });
  mkdirSync(dirname(out), { recursive: true });
  await Bun.write(`${out}.tmp`, new Blob([await Bun.file(library).arrayBuffer(), footer]));
  renameSync(`${out}.tmp`, out);
  return out;
}

if (import.meta.main) console.log(await buildZarrExtension());
