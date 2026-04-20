/**
 * `ndea update` — fetch the manifest, download the matching asset, verify
 * the checksum, stage it as `<self>.pending`, and drop a pending-update
 * marker so the swap happens on next launch.
 *
 * Rationale for "apply on next launch":
 *   - Windows won't let you rename the currently-running executable.
 *   - Linux/macOS *will* rename it but a long-running `ndea view` that's
 *     mmap'd shared libraries would get surprised.
 *
 * So we always stage + mark, never swap in place. Cheap and uniform.
 */

import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { acquireLock } from "../lib/lock.ts";
import type { Channel } from "../lib/manifest.ts";
import { CHANNELS, detectTarget, fetchManifest, parseShaFile, sha256Hex } from "../lib/manifest.ts";
import { installLockPath, isCompiledBinary, resolveSelfPath, stateDir } from "../lib/paths.ts";
import { writePendingUpdateMarker } from "../lib/pending-update.ts";
import { VERSION } from "../version.ts";

export default defineCommand({
  meta: {
    name: "update",
    description: "Download the latest ndea release and stage it for next launch",
  },
  args: {
    force: {
      type: "boolean",
      description: "Update even when already on the target version",
    },
    channel: {
      type: "string",
      description: "Release channel: stable | latest",
    },
  },
  async run({ args }) {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea update` only works from a compiled binary (not `bun run`).");
      process.exit(1);
    }

    const channel = resolveChannel(args.channel);
    detectTarget(); // validate platform early — throws if unsupported

    console.log(`  Checking for updates on channel "${channel}"…`);
    const asset = await fetchManifest(channel);
    const targetVersion = asset.tag.replace(/^v/, "");

    if (targetVersion === VERSION && args.force !== true) {
      console.log(`  Already on v${VERSION}. Use --force to re-install.`);
      return;
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      await mkdir(stateDir(), { recursive: true });

      console.log(`  Downloading ${asset.assetUrl}`);
      const [binRes, shaRes] = await Promise.all([fetch(asset.assetUrl), fetch(asset.shaUrl)]);
      if (!binRes.ok) throw new Error(`asset fetch failed: ${binRes.status} ${binRes.statusText}`);
      if (!shaRes.ok) throw new Error(`checksum fetch failed: ${shaRes.status} ${shaRes.statusText}`);

      const [bytes, shaBody] = await Promise.all([binRes.arrayBuffer(), shaRes.text()]);
      const expected = parseShaFile(shaBody);
      const actual = sha256Hex(bytes);
      if (actual !== expected) {
        throw new Error(`checksum mismatch: expected ${expected}, got ${actual}`);
      }
      console.log(`  Checksum OK (${expected.slice(0, 12)}…)`);

      const self = resolveSelfPath();
      const pendingPath = `${self}.pending`;
      await mkdir(dirname(pendingPath), { recursive: true });

      // Remove any orphaned `.pending` from a prior aborted run.
      if (existsSync(pendingPath)) {
        await Bun.$`rm -f ${pendingPath}`.quiet().catch(() => {});
      }

      await Bun.write(pendingPath, bytes);
      // Best-effort chmod — ignore errors on Windows.
      try {
        await Bun.$`chmod +x ${pendingPath}`.quiet();
      } catch {
        // non-fatal
      }

      await writePendingUpdateMarker({
        tag: asset.tag,
        pendingPath,
        sha256: expected,
        stagedAt: new Date().toISOString(),
      });

      console.log(`  Staged ${asset.tag} — will apply on next launch.`);
      console.log(`  Run any ndea command (e.g. 'ndea --version') to finalise the swap.`);
    } finally {
      await lock.release();
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveChannel(raw: unknown): Channel {
  const fromEnv = process.env.NDEA_CHANNEL;
  const candidate = typeof raw === "string" && raw.length > 0 ? raw : (fromEnv ?? "stable");
  if ((CHANNELS as readonly string[]).includes(candidate)) return candidate as Channel;
  console.error(`Error: unknown channel "${candidate}" (expected: ${CHANNELS.join(", ")})`);
  process.exit(1);
  // `process.exit` is `: never`, but ESLint's consistent-return still wants a
  // throw/return from the control-flow end — throw is clearer than a dead path.
  throw new Error("unreachable");
}
