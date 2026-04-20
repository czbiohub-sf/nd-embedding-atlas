/**
 * `ndea install` — Stage B of the self-installer.
 *
 * install.sh (Stage A) downloads + verifies the binary and drops it on disk,
 * then exec's `<binary> install --from-bootstrap`. This command owns:
 *   - picking the final destination ($NDEA_BIN_DIR → ~/.local/bin → /usr/local/bin)
 *   - acquiring the shared install/update flock
 *   - creating state dirs (~/.ndea, ~/.ndea/logs, ~/.ndea/locks)
 *   - moving the binary into place, chmod +x
 *   - recording version + checksum to ~/.ndea/current-version
 *   - warning if destination isn't on PATH
 */

import { defineCommand } from "citty";
import { chmod, mkdir, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { acquireLock } from "../lib/lock.ts";
import { sha256Hex } from "../lib/manifest.ts";
import {
  currentVersionPath,
  installLockPath,
  isCompiledBinary,
  locksDir,
  logsDir,
  resolveSelfPath,
  stateDir,
} from "../lib/paths.ts";
import { VERSION } from "../version.ts";

export default defineCommand({
  meta: {
    name: "install",
    description: "Place the ndea binary on PATH and set up state directories",
  },
  args: {
    "from-bootstrap": {
      type: "boolean",
      description: "Called from install.sh (Stage A)",
    },
    "bin-dir": {
      type: "string",
      description: "Override install destination (NDEA_BIN_DIR takes precedence)",
    },
    force: {
      type: "boolean",
      description: "Overwrite an existing binary without prompting",
    },
  },
  async run({ args }) {
    if (!isCompiledBinary() && args["from-bootstrap"] !== true) {
      console.error("Error: `ndea install` can only run from a compiled binary (you ran via `bun run`).");
      console.error("In dev, run `bun run src/cli/index.ts view ./data.zarr` instead.");
      process.exit(1);
    }

    const dest = resolveDestination(typeof args["bin-dir"] === "string" ? args["bin-dir"] : undefined);

    const lock = await acquireLock(installLockPath()).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${msg}`);
      console.error("Another install/update is in progress. Retry once it finishes.");
      process.exit(1);
    });

    try {
      await mkdir(stateDir(), { recursive: true });
      await mkdir(logsDir(), { recursive: true });
      await mkdir(locksDir(), { recursive: true });

      const src = resolveSelfPath();
      const target = resolve(dest, targetBasename());

      // If we're already at the target path, there's nothing to do.
      if (src === target) {
        console.log(`ndea is already installed at ${target}`);
      } else {
        await mkdir(dirname(target), { recursive: true });
        if (existsSync(target)) {
          if (args.force !== true) {
            console.error(
              `  existing ndea at ${target} will be replaced (use --force or set NDEA_OVERWRITE=1 to silence)`,
            );
          }
        }
        await chmod(src, 0o755).catch(() => {});
        await rename(src, target).catch(async (err: unknown) => {
          // rename across devices (tmpdir → HOME on some Linux setups) fails with EXDEV —
          // fall back to copy + unlink.
          if (err instanceof Error && "code" in err && (err as { code?: string }).code === "EXDEV") {
            const bytes = await Bun.file(src).arrayBuffer();
            await Bun.write(target, bytes);
            await chmod(target, 0o755);
            await Bun.$`rm -f ${src}`.quiet().catch(() => {});
          } else {
            throw err;
          }
        });
        console.log(`Installed ndea to ${target}`);
      }

      // Record current-version.
      const installed = existsSync(target) ? target : src;
      const bytes = await Bun.file(installed).arrayBuffer();
      const digest = sha256Hex(bytes);
      await Bun.write(currentVersionPath(), `v${VERSION}\n${digest}\n`);

      warnIfNotOnPath(dest);
    } finally {
      await lock.release();
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pick the install destination. Precedence:
 *   1. `--bin-dir` flag
 *   2. `$NDEA_BIN_DIR`
 *   3. `~/.local/bin`
 *   4. `/usr/local/bin` (only if writable)
 *
 * We never `sudo` — if the user wants a system path they can set
 * NDEA_BIN_DIR=/usr/local/bin and handle perms themselves.
 */
function resolveDestination(flag: string | undefined): string {
  if (flag) return resolve(flag);
  const env = process.env.NDEA_BIN_DIR;
  if (env) return resolve(env);
  return resolve(homedir(), ".local", "bin");
}

function targetBasename(): string {
  // Preserve .exe on Windows.
  const self = basename(resolveSelfPath());
  if (process.platform === "win32") return self.endsWith(".exe") ? "ndea.exe" : "ndea.exe";
  return "ndea";
}

function warnIfNotOnPath(dest: string): void {
  const pathEntries = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");
  if (pathEntries.includes(dest)) return;
  const shell = basename(process.env.SHELL ?? "/bin/sh");
  let rc = "your shell rc";
  if (shell === "zsh") rc = "~/.zshrc";
  else if (shell === "bash") rc = "~/.bashrc";
  else if (shell === "fish") rc = "~/.config/fish/config.fish";

  console.error("");
  console.error(`  ${dest} is not on PATH — add it to ${rc}:`);
  if (shell === "fish") {
    console.error(`      fish_add_path "${dest}"`);
  } else {
    console.error(`      export PATH="${dest}:$PATH"`);
  }
  console.error("");
}

// Re-export for tests (keeps the helpers in one place without widening the public API).
export const _internal = { resolveDestination, targetBasename, stat };
