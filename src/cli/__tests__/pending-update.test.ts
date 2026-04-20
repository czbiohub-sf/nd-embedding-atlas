/**
 * Tests for the pending-update marker reader/writer + lock helper.
 *
 * We avoid running `applyPendingUpdate()` against the test host's real
 * binary path — the helper short-circuits when not running a compiled
 * binary, so the test instead exercises the marker serialisation + lock.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../lib/lock.ts";
import {
  DISABLE_ENV,
  applyPendingUpdate,
  readPendingUpdateMarker,
  writePendingUpdateMarker,
} from "../lib/pending-update.ts";

// ─── Per-test sandbox ───────────────────────────────────────────────────────

const TMP_ROOT = join(tmpdir(), `ndea-pending-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(TMP_ROOT, { recursive: true });

let sandboxCounter = 0;
function makeSandbox(): string {
  const dir = join(TMP_ROOT, `s${sandboxCounter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // swallow
  }
});

// ─── Lock tests ─────────────────────────────────────────────────────────────

describe("acquireLock", () => {
  test("writes PID file and releases cleanly", async () => {
    const path = join(makeSandbox(), "test.lock");
    const lock = await acquireLock(path);
    expect(await Bun.file(path).exists()).toBe(true);
    const contents = await Bun.file(path).text();
    expect(Number.parseInt(contents.trim(), 10)).toBe(process.pid);
    await lock.release();
    expect(await Bun.file(path).exists()).toBe(false);
  });

  test("rejects when a live PID already holds the lock", async () => {
    const path = join(makeSandbox(), "contended.lock");
    const first = await acquireLock(path);
    try {
      await expect(acquireLock(path)).rejects.toThrow(/held by PID/);
    } finally {
      await first.release();
    }
  });

  test("reclaims a stale lock whose PID is dead", async () => {
    const path = join(makeSandbox(), "stale.lock");
    // Simulate a dead process — pid 1 exists and is usually not ours, but we
    // can't guarantee that. Use a plausibly-dead high PID.
    await Bun.write(path, "2147483640\n"); // very high, almost certainly not running
    const lock = await acquireLock(path);
    await lock.release();
  });
});

// ─── Marker read/write ──────────────────────────────────────────────────────

describe("pending-update marker", () => {
  test("round-trips via write → read", async () => {
    const sandbox = makeSandbox();
    const origHome = process.env.HOME;
    process.env.HOME = sandbox;
    try {
      await writePendingUpdateMarker({
        tag: "v0.9.9",
        pendingPath: "/tmp/ndea.pending",
        sha256: "c".repeat(64),
        stagedAt: "2026-04-19T00:00:00.000Z",
      });
      const read = await readPendingUpdateMarker();
      expect(read).not.toBeNull();
      expect(read?.tag).toBe("v0.9.9");
      expect(read?.pendingPath).toBe("/tmp/ndea.pending");
      expect(read?.sha256).toBe("c".repeat(64));
    } finally {
      if (origHome == null) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });

  test("readPendingUpdateMarker returns null when file is missing", async () => {
    const sandbox = makeSandbox();
    const origHome = process.env.HOME;
    process.env.HOME = sandbox;
    try {
      const read = await readPendingUpdateMarker();
      expect(read).toBeNull();
    } finally {
      if (origHome == null) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  });
});

// ─── applyPendingUpdate short-circuits ──────────────────────────────────────

describe("applyPendingUpdate (dev-mode short-circuits)", () => {
  test("skips when NDEA_DISABLE_AUTOUPDATER=1", async () => {
    const prev = process.env[DISABLE_ENV];
    process.env[DISABLE_ENV] = "1";
    try {
      const result = await applyPendingUpdate();
      expect(result).toBe("skipped");
    } finally {
      if (prev == null) delete process.env[DISABLE_ENV];
      else process.env[DISABLE_ENV] = prev;
    }
  });

  test("skips when running under `bun run` (not a compiled binary)", async () => {
    // In dev (tests) the execPath is `bun`, so isCompiledBinary() returns false.
    const prev = process.env[DISABLE_ENV];
    delete process.env[DISABLE_ENV];
    try {
      const result = await applyPendingUpdate();
      expect(result).toBe("skipped");
    } finally {
      if (prev != null) process.env[DISABLE_ENV] = prev;
    }
  });
});
