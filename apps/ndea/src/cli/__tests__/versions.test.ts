/**
 * `listVersions` selection logic, tested with a temporary home and
 * synthesized versions tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stateDir, versionsDir } from "../lib/paths.ts";
import { listVersions } from "../lib/versions.ts";

const TMP_HOME = resolve(import.meta.dir, "../../../.fallow/test-versions");
const TMP_STATE = resolve(TMP_HOME, ".ndea");
const ORIGINAL_HOME = process.env.HOME;

beforeEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
  await mkdir(TMP_HOME, { recursive: true });
  process.env.HOME = TMP_HOME;
});

afterEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
});

async function makeVersion(tag: string, mtime?: Date): Promise<void> {
  const dir = resolve(TMP_STATE, "versions", tag);
  await mkdir(dir, { recursive: true });
  const bin = resolve(dir, "ndea");
  await writeFile(bin, `fake binary ${tag}`);
  if (mtime) {
    const { utimes } = await import("node:fs/promises");
    await utimes(bin, mtime, mtime);
  }
}

describe("listVersions", () => {
  test("uses the fixed state directory under HOME", () => {
    expect(stateDir()).toBe(TMP_STATE);
    expect(versionsDir()).toBe(resolve(TMP_STATE, "versions"));
  });

  test("returns empty for missing dir", async () => {
    const root = resolve(TMP_STATE, "versions");
    expect(await listVersions(root)).toEqual([]);
  });

  test("returns entries sorted most-recent first", async () => {
    await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.1.1", new Date("2026-02-01"));
    await makeVersion("v0.2.0", new Date("2026-03-01"));

    const root = resolve(TMP_STATE, "versions");
    const out = await listVersions(root);
    expect(out.map((e) => e.tag)).toEqual(["v0.2.0", "v0.1.1", "v0.1.0"]);
  });

  test("skips entries whose ndea binary is missing", async () => {
    await makeVersion("v0.1.0");
    // Make an empty tag dir.
    const broken = resolve(TMP_STATE, "versions", "v0.2.0-broken");
    await mkdir(broken, { recursive: true });

    const root = resolve(TMP_STATE, "versions");
    const out = await listVersions(root);
    expect(out.map((e) => e.tag)).toEqual(["v0.1.0"]);
  });

  test("entries carry binaryPath", async () => {
    await makeVersion("v0.1.0");
    const root = resolve(TMP_STATE, "versions");
    const [entry] = await listVersions(root);
    expect(entry.binaryPath).toBe(resolve(root, "v0.1.0", "ndea"));
  });
});
