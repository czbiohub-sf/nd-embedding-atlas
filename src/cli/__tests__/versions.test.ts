/**
 * `listVersions` and the gc/rollback selection logic — pure helpers,
 * tested with a temp NDEA_HOME and synthesized versions/ tree.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listVersions } from "../lib/versions.ts";

const TMP_HOME = resolve(import.meta.dir, "../../../.fallow/test-versions");

beforeEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
  await mkdir(TMP_HOME, { recursive: true });
  process.env.NDEA_HOME = TMP_HOME;
});

afterEach(async () => {
  await rm(TMP_HOME, { recursive: true, force: true });
  delete process.env.NDEA_HOME;
});

async function makeVersion(tag: string, mtime?: Date): Promise<void> {
  const dir = resolve(TMP_HOME, "versions", tag);
  await mkdir(dir, { recursive: true });
  const bin = resolve(dir, "ndea.bin");
  const wrapper = resolve(dir, "ndea");
  await writeFile(bin, `fake binary ${tag}`);
  await writeFile(wrapper, `#!/bin/sh\nexec "${bin}" "$@"\n`);
  if (mtime) {
    const { utimes } = await import("node:fs/promises");
    await utimes(bin, mtime, mtime);
  }
}

describe("listVersions", () => {
  test("returns empty for missing dir", async () => {
    const root = resolve(TMP_HOME, "versions");
    expect(await listVersions(root)).toEqual([]);
  });

  test("returns entries sorted most-recent first", async () => {
    await makeVersion("v0.1.0", new Date("2026-01-01"));
    await makeVersion("v0.1.1", new Date("2026-02-01"));
    await makeVersion("v0.2.0", new Date("2026-03-01"));

    const root = resolve(TMP_HOME, "versions");
    const out = await listVersions(root);
    expect(out.map((e) => e.tag)).toEqual(["v0.2.0", "v0.1.1", "v0.1.0"]);
  });

  test("skips entries whose ndea.bin is missing", async () => {
    await makeVersion("v0.1.0");
    // Make a tag dir without ndea.bin inside (wrapper-only is incomplete).
    const broken = resolve(TMP_HOME, "versions", "v0.2.0-broken");
    await mkdir(broken, { recursive: true });
    await writeFile(resolve(broken, "ndea"), "#!/bin/sh\nexit 0\n");

    const root = resolve(TMP_HOME, "versions");
    const out = await listVersions(root);
    expect(out.map((e) => e.tag)).toEqual(["v0.1.0"]);
  });

  test("entries carry both wrapper and binary paths", async () => {
    await makeVersion("v0.1.0");
    const root = resolve(TMP_HOME, "versions");
    const [entry] = await listVersions(root);
    expect(entry.wrapperPath).toBe(resolve(root, "v0.1.0", "ndea"));
    expect(entry.binaryPath).toBe(resolve(root, "v0.1.0", "ndea.bin"));
  });
});
