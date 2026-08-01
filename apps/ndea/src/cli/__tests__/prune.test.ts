/**
 * Tests for the shared prune helper used by `gc` and `update --no-gc=false`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneVersionCaches, pruneVersions } from "../lib/prune.ts";

const TMP_HOME = resolve(import.meta.dir, "../../../.fallow/test-prune");

beforeEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
  await mkdir(TMP_HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
});

async function makeVersion(tag: string, mtime: Date): Promise<{ bin: string }> {
  const dir = resolve(TMP_HOME, "versions", tag);
  await mkdir(dir, { recursive: true });
  const bin = resolve(dir, "ndea");
  await writeFile(bin, `binary ${tag}`);
  await utimes(bin, mtime, mtime);
  return { bin };
}

describe("pruneVersions", () => {
  test("preserves the active version even when older than the keep cutoff", async () => {
    const root = resolve(TMP_HOME, "versions");
    const old = await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.2.0", new Date("2026-02-01"));
    await makeVersion("v0.3.0", new Date("2026-03-01"));

    // Active = oldest. keep=1 means "active only": prune the two newer ones.
    const result = await pruneVersions({ root, activeAbs: old.bin, keep: 1 });
    expect(result.pruned.map((e) => e.tag).toSorted()).toEqual(["v0.2.0", "v0.3.0"]);
    expect(result.active?.tag).toBe("v0.1.0");
    expect(existsSync(resolve(root, "v0.1.0"))).toBe(true);
    expect(existsSync(resolve(root, "v0.2.0"))).toBe(false);
    expect(existsSync(resolve(root, "v0.3.0"))).toBe(false);
  });

  test("keep=2 retains active + 1 newest non-active", async () => {
    const root = resolve(TMP_HOME, "versions");
    await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.2.0", new Date("2026-02-01"));
    const active = await makeVersion("v0.3.0", new Date("2026-03-01"));

    const result = await pruneVersions({ root, activeAbs: active.bin, keep: 2 });
    expect(result.pruned.map((e) => e.tag)).toEqual(["v0.1.0"]);
    expect(result.kept.map((e) => e.tag).toSorted()).toEqual(["v0.2.0", "v0.3.0"]);
  });

  test("no active version → prunes by mtime alone", async () => {
    const root = resolve(TMP_HOME, "versions");
    await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.2.0", new Date("2026-02-01"));
    await makeVersion("v0.3.0", new Date("2026-03-01"));

    const result = await pruneVersions({ root, activeAbs: null, keep: 2 });
    expect(result.pruned.map((e) => e.tag)).toEqual(["v0.1.0"]);
    expect(result.kept.map((e) => e.tag).toSorted()).toEqual(["v0.2.0", "v0.3.0"]);
  });

  test("Infinity keep is a no-op", async () => {
    const root = resolve(TMP_HOME, "versions");
    await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.2.0", new Date("2026-02-01"));

    const result = await pruneVersions({ root, activeAbs: null, keep: Infinity });
    expect(result.pruned).toEqual([]);
    expect(result.kept.length).toBe(2);
  });

  test("empty versions tree returns empty result", async () => {
    const root = resolve(TMP_HOME, "versions");
    await mkdir(root, { recursive: true });
    const result = await pruneVersions({ root, activeAbs: null, keep: 2 });
    expect(result).toEqual({ pruned: [], kept: [], active: undefined, freedBytes: 0 });
  });
});

describe("pruneVersionCaches", () => {
  test("removes cache directories matching v-prefixed release tags", async () => {
    const root = resolve(TMP_HOME, "cache");
    const stale = resolve(root, "0.1.0");
    const active = resolve(root, "0.2.0");
    await mkdir(stale, { recursive: true });
    await mkdir(active, { recursive: true });
    await writeFile(resolve(stale, "libduckdb.so"), "cached library");

    const freedBytes = await pruneVersionCaches(["v0.1.0"], root);
    expect(freedBytes).toBeGreaterThan(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(active)).toBe(true);
  });
});
