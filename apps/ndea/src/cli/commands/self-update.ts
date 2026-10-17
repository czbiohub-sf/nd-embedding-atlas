/**
 * `ndea self update`: resolve a GitHub release, download the matching binary
 * into the versions tree, and atomically repoint the active symlink.
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

import { defineCommand } from "@crustjs/core";
import { chmod, mkdir, rename, symlink, unlink } from "node:fs/promises";
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
import { CHANNELS, detectTarget, fetchRelease, parseShaFile, sha256Hex } from "../lib/releases.ts";
import { label, mb, ok, task, url } from "../lib/style.ts";
import { VERSION } from "../version.ts";

/** Versions retained after a successful update; each one costs ~185 MB on disk. */
const AUTO_GC_KEEP = 1;

export default defineCommand(
  "update",
  { description: "Download the latest ndea release and switch to it" },
  (command) =>
    command
      .flags(
        {
          name: "force",
          type: "boolean",
          default: false,
          description: "Update even when already on the target version",
        },
        {
          name: "channel",
          type: "string",
          choices: CHANNELS,
          default: "stable",
          description: `Release channel: ${CHANNELS.join(" | ")}`,
        },
        {
          name: "gc",
          type: "boolean",
          default: true,
          description: "Prune inactive versions after updating",
        },
      )
      .action(async ({ flags, stdout, signal }) => {
        if (!isCompiledBinary()) {
          throw new Error("`ndea self update` only works from a compiled binary, not a source checkout");
        }

        // Windows ships the binary but not the versions-tree + symlink layout
        // this command swaps, so there is nothing here to update in place.
        if (process.platform === "win32") {
          throw new Error(
            "`ndea self update` is not supported on Windows\n" +
              "  re-run the installer to move to a new release:\n" +
              "    irm https://czbiohub-sf.github.io/nd-embedding-atlas/install.ps1 | iex",
          );
        }

        const channel = flags.channel;
        detectTarget(); // validate platform early: throws if unsupported

        stdout(`  ${label(`Checking for updates on channel "${channel}"…`)}`);
        const asset = await fetchRelease(channel);
        const targetVersion = asset.tag.replace(/^v/, "");
        const manager = await detectInstallManager();

        if (manager.kind === "mise") {
          if (!manager.sourceConfig) {
            throw new Error(
              "this binary belongs to mise, but no mise source config could be identified\n" +
                `  activate it with \`mise use -g ${MISE_TOOL_ID}\`, then retry`,
            );
          }
          // Compare against what mise activates, not what this process compiled
          // in: a stale binary invoked directly must still move the pin forward.
          const installedVersion = manager.activeVersion ?? VERSION;
          if (targetVersion === installedVersion && !flags.force) {
            stdout(`  ${ok(`Already on v${installedVersion}.`)} ${label("Use --force to re-install.")}`);
            return;
          }
          const exitCode = await runMiseUse(
            manager.sourceConfig,
            asset.tag,
            channel,
            manager.requestedVersion,
            flags.force,
          );
          if (exitCode !== 0) throw new Error(`mise use exited with code ${exitCode}`);
          return;
        }

        if (targetVersion === VERSION && !flags.force) {
          stdout(`  ${ok(`Already on v${VERSION}.`)} ${label("Use --force to re-install.")}`);
          return;
        }

        const link = requireActiveLauncher();
        const activeTarget = await resolveLauncherTarget(link);
        if (!activeTarget || !pathContains(versionsDir(), activeTarget)) {
          throw new Error(
            `active launcher ${link} is not a symlink into ${versionsDir()}\n` +
              "  refusing to modify an install not owned by the standalone ndea installer",
          );
        }

        const lock = await acquireLock(installLockPath());
        try {
          const targetDir = versionDir(asset.tag);
          const targetBin = versionedBinaryPath(asset.tag);
          await mkdir(targetDir, { recursive: true });

          stdout(`  ${label("Downloading")} ${url(asset.assetUrl)}`);
          const [binRes, binShaRes] = await Promise.all([
            fetch(asset.assetUrl, { signal }),
            fetch(asset.shaUrl, { signal }),
          ]);
          if (!binRes.ok || !binRes.body) throw new Error(`asset fetch failed: ${binRes.status} ${binRes.statusText}`);
          if (!binShaRes.ok) throw new Error(`checksum fetch failed: ${binShaRes.status} ${binShaRes.statusText}`);

          const total = Number(binRes.headers.get("content-length")) || 0;
          const body = binRes.body;
          const bytes = await task(`Downloading ${asset.tag}`, async (update) => {
            const chunks: Uint8Array[] = [];
            let received = 0;
            for await (const chunk of body) {
              chunks.push(chunk);
              received += chunk.length;
              update(`Downloading ${asset.tag}  ${mb(received)}${total ? ` / ${mb(total)}` : ""}`);
            }
            update(`Downloaded ${asset.tag}  ${mb(received)}`);
            return Buffer.concat(chunks);
          });
          const expected = parseShaFile(await binShaRes.text());
          const actual = sha256Hex(bytes);
          if (actual !== expected) {
            throw new Error(`binary checksum mismatch: expected ${expected}, got ${actual}`);
          }
          stdout(`  ${ok(`Checksum OK ${label(`(${expected.slice(0, 12)}…)`)}`)}`);

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

          stdout(`  ${ok(`Installed ${asset.tag} → ${link}`)}`);

          // `--no-gc` opts out for debugging or bisecting across versions.
          if (flags.gc) {
            const result = await pruneVersions({
              root: versionsDir(),
              activeAbs: targetBin,
              keep: AUTO_GC_KEEP,
            });
            result.freedBytes += await pruneVersionCaches(result.pruned.map((entry) => entry.tag));
            if (result.pruned.length > 0) {
              const tags = result.pruned.map((e) => e.tag).join(", ");
              stdout(
                `  ${ok(`Pruned ${result.pruned.length} version(s) ${label(`[${tags}]`)}, freed ${mb(result.freedBytes)}`)}`,
              );
            }
          }

          stdout(`  ${label("Run `ndea --version` to confirm.")}`);
        } finally {
          await lock.release();
        }
      }),
);
