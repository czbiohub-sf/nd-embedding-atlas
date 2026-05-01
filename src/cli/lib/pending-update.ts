/**
 * Apply a staged `.pending` update at startup.
 *
 * `ndea update` writes the downloaded binary to `<self>.pending` and drops a
 * JSON marker at `~/.ndea/pending-update`. On next launch we:
 *
 *   1. Load the marker
 *   2. Verify the `.pending` file still exists + matches the recorded checksum
 *   3. Atomic-swap: `<self>` → `<self>.bak`, `.pending` → `<self>`
 *   4. Delete the marker
 *   5. Re-exec the freshly-swapped binary with the original argv (and a flag
 *      to prevent re-entry, in case the new binary would try to apply again)
 *
 * The check is skipped when:
 *   - `NDEA_DISABLE_AUTOUPDATER=1` is set
 *   - we're not running a compiled binary (i.e. `bun run` in dev)
 *   - no marker exists
 *   - the marker or `.pending` file is corrupt (logged, not fatal)
 */

import { log } from "@bunli/utils";
import { existsSync } from "node:fs";
import { readFile, rename, rm, stat } from "node:fs/promises";
import { sha256Hex } from "./manifest.ts";
import { currentVersionPath, isCompiledBinary, pendingUpdateMarkerPath, resolveSelfPath } from "./paths.ts";

/** JSON shape of `~/.ndea/pending-update`. */
export interface PendingUpdateMarker {
  tag: string;
  pendingPath: string;
  sha256: string;
  /** ISO timestamp the update was staged at. */
  stagedAt: string;
}

/** Env var name users set to opt out of the auto-applier. */
export const DISABLE_ENV = "NDEA_DISABLE_AUTOUPDATER";
/** Internal guard env var — prevents recursive re-exec if swap + re-exec loop. */
export const APPLIED_ENV = "NDEA_PENDING_UPDATE_APPLIED";

/**
 * Try to apply a pending update. Returns:
 *   - "applied"      → swap succeeded; caller should NOT continue the normal
 *                      startup path because we've already spawned the replacement.
 *   - "skipped"      → no update to apply (normal fast path).
 *   - "error"        → attempted apply failed; caller should continue with the
 *                      current binary. Errors are logged to stderr but do not
 *                      bubble up as exceptions — a broken update must never
 *                      brick the CLI.
 */
export async function applyPendingUpdate(): Promise<"applied" | "skipped" | "error"> {
  if (process.env[DISABLE_ENV] === "1") return "skipped";
  if (process.env[APPLIED_ENV] === "1") return "skipped";
  if (!isCompiledBinary()) return "skipped";

  const markerPath = pendingUpdateMarkerPath();
  if (!existsSync(markerPath)) return "skipped";

  let marker: PendingUpdateMarker;
  try {
    const raw = await readFile(markerPath, "utf8");
    marker = parseMarker(raw);
  } catch (err) {
    await safeRm(markerPath);
    logWarn(`pending-update marker unreadable — cleared: ${errMsg(err)}`);
    return "error";
  }

  const { pendingPath, sha256, tag } = marker;

  if (!existsSync(pendingPath)) {
    await safeRm(markerPath);
    logWarn(`pending-update staged binary missing (${pendingPath}) — marker cleared`);
    return "error";
  }

  // Verify checksum to defend against truncated downloads / disk corruption.
  try {
    const bytes = await Bun.file(pendingPath).arrayBuffer();
    const actual = sha256Hex(bytes);
    if (actual !== sha256.toLowerCase()) {
      await safeRm(markerPath);
      await safeRm(pendingPath);
      logWarn(`pending-update checksum mismatch (expected ${sha256}, got ${actual}) — discarded`);
      return "error";
    }
  } catch (err) {
    logWarn(`pending-update checksum read failed: ${errMsg(err)}`);
    return "error";
  }

  const self = resolveSelfPath();
  const bak = `${self}.bak`;

  try {
    // Remove the previous .bak if it exists (one-level history).
    if (existsSync(bak)) {
      await rm(bak, { force: true });
    }
    await rename(self, bak);
    await rename(pendingPath, self);
  } catch (err) {
    logWarn(`pending-update swap failed: ${errMsg(err)}`);
    // Attempt to recover the original binary in case the first rename
    // succeeded but the second didn't.
    if (!existsSync(self) && existsSync(bak)) {
      try {
        await rename(bak, self);
      } catch {
        // Best-effort — if this fails we've left the user in a bad state.
      }
    }
    return "error";
  }

  // Record the new installed version.
  try {
    await Bun.write(currentVersionPath(), `${tag}\n${sha256}\n`);
  } catch {
    // Non-fatal — the bookkeeping file is advisory.
  }

  await safeRm(markerPath);

  // Re-exec the freshly-swapped binary with the original argv. Set the guard
  // env var so the replacement skips this check on startup.
  try {
    const argv = Bun.argv.slice(2); // skip executable + entry
    const proc = Bun.spawn([self, ...argv], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: { ...process.env, [APPLIED_ENV]: "1" },
    });
    const code = await proc.exited;
    process.exit(typeof code === "number" ? code : 0);
  } catch (err) {
    logWarn(`pending-update re-exec failed: ${errMsg(err)}`);
    return "error";
  }
  // Unreachable — `process.exit` is `: never`. Added for consistent-return.
  return "applied";
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseMarker(raw: string): PendingUpdateMarker {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const tag = typeof parsed.tag === "string" ? parsed.tag : null;
  const pendingPath = typeof parsed.pendingPath === "string" ? parsed.pendingPath : null;
  const sha256 = typeof parsed.sha256 === "string" ? parsed.sha256 : null;
  const stagedAt = typeof parsed.stagedAt === "string" ? parsed.stagedAt : new Date().toISOString();
  if (!tag || !pendingPath || !sha256) {
    throw new Error("pending-update marker missing tag/pendingPath/sha256");
  }
  return { tag, pendingPath, sha256, stagedAt };
}

async function safeRm(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch {
    // best-effort
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Diagnostic logger for pending-update path. Uses @bunli/utils `log()` so
 * output is structured (level + prefix), routes to stderr, and auto-strips
 * ANSI when stdout is piped (e.g. agent / CI consumers reading our output).
 */
function logWarn(msg: string): void {
  log(msg, { level: "warn", prefix: "ndea" });
}

/**
 * Write a pending-update marker. Exposed separately so `ndea update` and the
 * test suite share one codepath.
 */
export async function writePendingUpdateMarker(marker: PendingUpdateMarker): Promise<void> {
  await Bun.write(pendingUpdateMarkerPath(), `${JSON.stringify(marker, null, 2)}\n`);
}

/** Inspect the current pending-update state without applying (for `--dry-run` / diagnostics). */
export async function readPendingUpdateMarker(): Promise<PendingUpdateMarker | null> {
  const p = pendingUpdateMarkerPath();
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, "utf8");
    return parseMarker(raw);
  } catch {
    return null;
  }
}

/** Exposed for tests — returns the staged binary's size in bytes, or null. */
export async function pendingBinarySize(): Promise<number | null> {
  const marker = await readPendingUpdateMarker();
  if (!marker) return null;
  try {
    const info = await stat(marker.pendingPath);
    return info.size;
  } catch {
    return null;
  }
}
