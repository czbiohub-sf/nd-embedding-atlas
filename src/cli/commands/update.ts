/**
 * `ndea update` — fetch the manifest, download the matching binary +
 * libduckdb sidecar into the versions tree, regenerate the wrapper script,
 * and atomically repoint the active symlink.
 *
 * Layout written by this command (mirrors install.sh):
 *   ~/.ndea/versions/<tag>/ndea               — POSIX-sh wrapper
 *   ~/.ndea/versions/<tag>/ndea.bin           — bun-compiled binary
 *   ~/.ndea/versions/<tag>/libduckdb.{dylib,so} — DuckDB sidecar
 *   $bin_dir/ndea                             — symlink → versions/<tag>/ndea
 *
 * The "atomic symlink swap" trick (write to a sibling temp name, then
 * `rename(2)` over the live link) gives crash-safety without the
 * pending/applier dance the old layout needed. Old versions stay on disk
 * for `ndea rollback`.
 */

import { defineCommand, option } from "@bunli/core";
import { chmod, mkdir, rename, symlink, unlink } from "node:fs/promises";
import { z } from "zod";
import { acquireLock } from "../lib/lock.ts";
import type { Channel } from "../lib/manifest.ts";
import { CHANNELS, detectTarget, fetchManifest, parseShaFile, sha256Hex } from "../lib/manifest.ts";
import {
  currentVersionPath,
  installLockPath,
  isCompiledBinary,
  requireActiveLauncher,
  versionDir,
  versionedBinaryPath,
  versionedDylibPath,
  versionedWrapperPath,
  versionsDir,
} from "../lib/paths.ts";
import { pruneVersions } from "../lib/prune.ts";
import { VERSION } from "../version.ts";
import { WRAPPER_SCRIPT_CONTENT } from "../lib/wrapper-script.ts";

/**
 * Default versions retained after auto-gc on a successful update.
 * Active + one rollback target = 2. Each version is ~190 MB on disk
 * (binary + libduckdb sidecar), so the steady-state ceiling is ~380 MB.
 */
const AUTO_GC_KEEP = 2;

export default defineCommand({
  name: "update" as const,
  description: "Download the latest ndea release and switch to it",
  options: {
    force: option(z.coerce.boolean().default(false), {
      description: "Update even when already on the target version",
    }),
    channel: option(z.enum(CHANNELS).optional(), {
      description: `Release channel: ${CHANNELS.join(" | ")}`,
    }),
    "no-gc": option(z.coerce.boolean().default(false), {
      description: `Skip the post-update gc that prunes to ${AUTO_GC_KEEP} versions`,
    }),
  },
  async handler({ flags }) {
    if (!isCompiledBinary()) {
      console.error("Error: `ndea update` only works from a compiled binary (not `bun run`).");
      process.exit(1);
    }

    if (process.env.NDEA_DISABLE_UPDATES === "1") {
      console.error("ndea: updates disabled by NDEA_DISABLE_UPDATES");
      process.exit(1);
    }

    const channel = resolveChannel(flags.channel);
    detectTarget(); // validate platform early — throws if unsupported

    console.log(`  Checking for updates on channel "${channel}"…`);
    const asset = await fetchManifest(channel);
    const targetVersion = asset.tag.replace(/^v/, "");

    if (targetVersion === VERSION && !flags.force) {
      console.log(`  Already on v${VERSION}. Use --force to re-install.`);
      return;
    }

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });

    try {
      const targetDir = versionDir(asset.tag);
      const targetBin = versionedBinaryPath(asset.tag);
      const targetWrapper = versionedWrapperPath(asset.tag);
      const targetDylib = versionedDylibPath(asset.tag);
      await mkdir(targetDir, { recursive: true });

      // Download binary + sidecar in parallel; fetch SHAs alongside so we
      // hit the network once per asset rather than serializing.
      console.log(`  Downloading ${asset.assetUrl}`);
      console.log(`  Downloading ${asset.dylibAssetUrl}`);
      const [binRes, binShaRes, dylibRes, dylibShaRes] = await Promise.all([
        fetch(asset.assetUrl),
        fetch(asset.shaUrl),
        fetch(asset.dylibAssetUrl),
        fetch(asset.dylibShaUrl),
      ]);
      if (!binRes.ok) throw new Error(`asset fetch failed: ${binRes.status} ${binRes.statusText}`);
      if (!binShaRes.ok) throw new Error(`checksum fetch failed: ${binShaRes.status} ${binShaRes.statusText}`);
      if (!dylibRes.ok) throw new Error(`dylib fetch failed: ${dylibRes.status} ${dylibRes.statusText}`);
      if (!dylibShaRes.ok)
        throw new Error(`dylib checksum fetch failed: ${dylibShaRes.status} ${dylibShaRes.statusText}`);

      const [bytes, shaBody, dylibBytes, dylibShaBody] = await Promise.all([
        binRes.arrayBuffer(),
        binShaRes.text(),
        dylibRes.arrayBuffer(),
        dylibShaRes.text(),
      ]);
      const expected = parseShaFile(shaBody);
      const actual = sha256Hex(bytes);
      if (actual !== expected) {
        throw new Error(`binary checksum mismatch: expected ${expected}, got ${actual}`);
      }
      const dylibExpected = parseShaFile(dylibShaBody);
      const dylibActual = sha256Hex(dylibBytes);
      if (dylibActual !== dylibExpected) {
        throw new Error(`dylib checksum mismatch: expected ${dylibExpected}, got ${dylibActual}`);
      }
      console.log(`  Checksum OK (binary ${expected.slice(0, 12)}…, dylib ${dylibExpected.slice(0, 12)}…)`);

      await Bun.write(targetBin, bytes);
      await chmod(targetBin, 0o755);
      await Bun.write(targetDylib, dylibBytes);
      await Bun.write(targetWrapper, WRAPPER_SCRIPT_CONTENT);
      await chmod(targetWrapper, 0o755);

      // Atomic symlink swap — write `<link>.tmp` then rename(2) over the
      // live link. POSIX rename is atomic for both files and symlinks; the
      // running binary keeps its open file handle to the old version, so
      // long-lived `ndea view` sessions are unaffected. Symlink points at
      // the wrapper, not the binary, so the LD_LIBRARY_PATH plumbing runs
      // on every invocation.
      const link = requireActiveLauncher();
      const tmpLink = `${link}.tmp`;
      await unlink(tmpLink).catch(() => {});
      await symlink(targetWrapper, tmpLink);
      await rename(tmpLink, link);

      await Bun.write(currentVersionPath(), `${asset.tag}\n${expected}\n`);

      console.log(`  Installed ${asset.tag} → ${link}`);

      // Auto-prune: each version takes ~190 MB (binary + libduckdb sidecar).
      // Default keeps current + 1 rollback target. `--no-gc` opts out for
      // users who want history (debugging, bisecting, multi-channel).
      if (!flags["no-gc"]) {
        const result = await pruneVersions({
          root: versionsDir(),
          activeAbs: targetWrapper,
          keep: AUTO_GC_KEEP,
        });
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
  const fromEnv = process.env.NDEA_CHANNEL;
  const candidate: string = raw ?? fromEnv ?? "stable";
  if ((CHANNELS as readonly string[]).includes(candidate)) return candidate as Channel;
  console.error(`Error: unknown channel "${candidate}" (expected: ${CHANNELS.join(", ")})`);
  process.exit(1);
  // `process.exit` is `: never`, but the lint rule's control-flow analysis
  // doesn't pick that up — throw explicitly so consistent-return is happy.
  throw new Error("unreachable");
}
