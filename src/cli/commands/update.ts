/**
 * `ndea update` — fetch the manifest, download the matching asset into the
 * versions tree, and atomically repoint the active symlink.
 *
 * Layout:
 *   ~/.ndea/versions/<tag>/ndea     — the binary for this version
 *   $bin_dir/ndea                   — symlink → ~/.ndea/versions/<tag>/ndea
 *
 * The "atomic symlink swap" trick (write to a sibling temp name, then
 * `rename(2)` over the live link) gives crash-safety without the
 * pending/applier dance the old layout needed. Old versions stay on disk
 * for `ndea rollback`.
 */

import { defineCommand, option } from "@bunli/core";
import { chmod, mkdir, readlink, rename, symlink, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { acquireLock } from "../lib/lock.ts";
import type { Channel } from "../lib/manifest.ts";
import { CHANNELS, detectTarget, fetchManifest, parseShaFile, sha256Hex } from "../lib/manifest.ts";
import {
  currentVersionPath,
  installLockPath,
  isCompiledBinary,
  resolveSelfPath,
  versionDir,
  versionedBinaryPath,
} from "../lib/paths.ts";
import { VERSION } from "../version.ts";

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
      await mkdir(targetDir, { recursive: true });

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

      await Bun.write(targetBin, bytes);
      await chmod(targetBin, 0o755);

      // Atomic symlink swap — write `<link>.tmp` then rename(2) over the
      // live link. POSIX rename is atomic for both files and symlinks; the
      // running binary keeps its open file handle to the old version, so
      // long-lived `ndea view` sessions are unaffected.
      const link = await resolveActiveLink();
      const tmpLink = `${link}.tmp`;
      await unlink(tmpLink).catch(() => {});
      await symlink(targetBin, tmpLink);
      await rename(tmpLink, link);

      await Bun.write(currentVersionPath(), `${asset.tag}\n${expected}\n`);

      console.log(`  Installed ${asset.tag} → ${link}`);
      console.log(`  Run \`ndea --version\` to confirm.`);
    } finally {
      await lock.release();
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * The symlink path users invoke as `ndea` — i.e. the file on PATH.
 *
 * On a fresh install via install.sh this is already a symlink. On systems
 * upgraded from the pre-Phase-3 layout (binary-as-regular-file at the same
 * path), `resolveSelfPath()` returns the regular file's path; the rename
 * over it during update converts it to a symlink in one atomic step.
 */
async function resolveActiveLink(): Promise<string> {
  const self = resolveSelfPath();
  // If `self` is a symlink, the rename target is the link itself, not its
  // resolved destination. `readlink` succeeds on a symlink and throws on
  // a regular file — either way, the path we want to write is `self`.
  await readlink(self).catch(() => {});
  return resolve(self);
}

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
