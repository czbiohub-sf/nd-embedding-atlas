/**
 * `ndea update`: resolve a GitHub release, download the matching binary into
 * the versions tree, and atomically repoint the active symlink.
 *
 * Layout written by this command (mirrors install.sh):
 *   ~/.ndea/versions/<tag>/ndea              : bun-compiled binary
 *   ~/.local/bin/ndea                        : symlink → versions/<tag>/ndea
 *
 * The binary embeds libduckdb and extracts it to ~/.cache/ndea/<version>/
 * on first run, so no sidecar download is needed.
 *
 * The "atomic symlink swap" trick (write to a sibling temp name, then
 * `rename(2)` over the live link) gives crash-safety.
 */

import { defineCommand, option } from "@bunli/core";
import { chmod, mkdir, rename, symlink, unlink } from "node:fs/promises";
import { z } from "zod";
import { detectInstallManager, MISE_TOOL_ID, pathContains, runMiseUse } from "../lib/install-manager.ts";
import { acquireLock } from "../lib/lock.ts";
import {
  currentVersionPath,
  installLockPath,
  isCompiledBinary,
  requireActiveLauncher,
  resolveLauncherTarget,
  versionDir,
  versionedBinaryPath,
  versionsDir,
} from "../lib/paths.ts";
import { pruneVersionCaches, pruneVersions } from "../lib/prune.ts";
import type { Channel } from "../lib/releases.ts";
import { CHANNELS, detectTarget, fetchRelease, parseShaFile, sha256Hex } from "../lib/releases.ts";
import { VERSION } from "../version.ts";

/** Versions retained after a successful update; each one costs ~185 MB on disk. */
const AUTO_GC_KEEP = 1;

export default defineCommand({
  name: "update" as const,
  description: "Download the latest ndea release and switch to it",
  options: {
    force: option(z.coerce.boolean().default(false), {
      description: "Update even when already on the target version",
      argumentKind: "flag",
    }),
    channel: option(z.enum(CHANNELS).optional(), {
      description: `Release channel: ${CHANNELS.join(" | ")}`,
    }),
    "no-gc": option(z.coerce.boolean().default(false), {
      description: "Skip the post-update gc that removes inactive versions",
      argumentKind: "flag",
    }),
  },
  async handler({ flags }) {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea update` only works from a compiled binary, not a source checkout.");
      process.exit(1);
    }

    const channel = resolveChannel(flags.channel);
    detectTarget(); // validate platform early: throws if unsupported

    console.log(`  Checking for updates on channel "${channel}"…`);
    const asset = await fetchRelease(channel);
    const targetVersion = asset.tag.replace(/^v/, "");
    const manager = await detectInstallManager();

    if (manager.kind === "mise") {
      if (!manager.sourceConfig) {
        console.error("Error: this binary belongs to mise, but no mise source config could be identified.");
        console.error(`  Activate it with \`mise use -g ${MISE_TOOL_ID}\`, then retry.`);
        process.exit(1);
        throw new Error("unreachable");
      }
      // Compare against what mise activates, not what this process compiled
      // in: a stale binary invoked directly must still move the pin forward.
      const installedVersion = manager.activeVersion ?? VERSION;
      if (targetVersion === installedVersion && !flags.force) {
        console.log(`  Already on v${installedVersion}. Use --force to re-install.`);
        return;
      }
      const exitCode = await runMiseUse(
        manager.sourceConfig,
        asset.tag,
        channel,
        manager.requestedVersion,
        flags.force,
      );
      if (exitCode !== 0) {
        process.exit(exitCode);
        throw new Error("unreachable");
      }
      return;
    }

    if (targetVersion === VERSION && !flags.force) {
      console.log(`  Already on v${VERSION}. Use --force to re-install.`);
      return;
    }

    const link = requireActiveLauncher();
    const activeTarget = await resolveLauncherTarget(link);
    if (!activeTarget || !pathContains(versionsDir(), activeTarget)) {
      console.error(`Error: active launcher ${link} is not a symlink into ${versionsDir()}.`);
      console.error("  Refusing to modify an install not owned by the standalone ndea installer.");
      process.exit(1);
      throw new Error("unreachable");
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      const targetDir = versionDir(asset.tag);
      const targetBin = versionedBinaryPath(asset.tag);
      await mkdir(targetDir, { recursive: true });

      console.log(`  Downloading ${asset.assetUrl}`);
      const [binRes, binShaRes] = await Promise.all([fetch(asset.assetUrl), fetch(asset.shaUrl)]);
      if (!binRes.ok) throw new Error(`asset fetch failed: ${binRes.status} ${binRes.statusText}`);
      if (!binShaRes.ok) throw new Error(`checksum fetch failed: ${binShaRes.status} ${binShaRes.statusText}`);

      const [bytes, shaBody] = await Promise.all([binRes.arrayBuffer(), binShaRes.text()]);
      const expected = parseShaFile(shaBody);
      const actual = sha256Hex(bytes);
      if (actual !== expected) {
        throw new Error(`binary checksum mismatch: expected ${expected}, got ${actual}`);
      }
      console.log(`  Checksum OK (${expected.slice(0, 12)}…)`);

      const tmpBin = `${targetBin}.tmp-${process.pid}`;
      try {
        await unlink(tmpBin).catch(() => {});
        await Bun.write(tmpBin, bytes);
        await chmod(tmpBin, 0o755);
        await rename(tmpBin, targetBin);
      } finally {
        await unlink(tmpBin).catch(() => {});
      }

      // Atomic symlink swap: write `<link>.tmp` then rename(2) over the
      // live link. POSIX rename is atomic for both files and symlinks; the
      // running binary keeps its open file handle to the old version, so
      // long-lived `ndea view` sessions are unaffected.
      const tmpLink = `${link}.tmp`;
      await unlink(tmpLink).catch(() => {});
      await symlink(targetBin, tmpLink);
      await rename(tmpLink, link);

      await Bun.write(currentVersionPath(), `${asset.tag}\n${expected}\n`);

      console.log(`  Installed ${asset.tag} → ${link}`);

      // `--no-gc` opts out for debugging or bisecting across versions.
      if (!flags["no-gc"]) {
        const result = await pruneVersions({
          root: versionsDir(),
          activeAbs: targetBin,
          keep: AUTO_GC_KEEP,
        });
        result.freedBytes += await pruneVersionCaches(result.pruned.map((entry) => entry.tag));
        if (result.pruned.length > 0) {
          const mb = (result.freedBytes / (1024 * 1024)).toFixed(1);
          const tags = result.pruned.map((e) => e.tag).join(", ");
          console.log(`  Auto-gc: pruned ${result.pruned.length} version(s) [${tags}], freed ${mb} MB`);
        }
      }

      console.log(`  Run \`ndea --version\` to confirm.`);
    } finally {
      await lock.release();
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveChannel(raw: Channel | undefined): Channel {
  const candidate: string = raw ?? "stable";
  if ((CHANNELS as readonly string[]).includes(candidate)) return candidate as Channel;
  console.error(`Error: unknown channel "${candidate}" (expected: ${CHANNELS.join(", ")})`);
  process.exit(1);
  // `process.exit` is `: never`, but the lint rule's control-flow analysis
  // doesn't pick that up: throw explicitly so consistent-return is happy.
  throw new Error("unreachable");
}
