/**
 * `ndea doctor` — read-only diagnostics. Prints binary path, symlink
 * integrity, active version, installed versions, and (with
 * `--check-network`) manifest reachability.
 *
 * Exit code 0 if healthy; 1 if a hard anomaly is detected (broken symlink,
 * unreadable state, missing active binary). Soft warnings (mismatched
 * current-version vs compiled-in tag) only bump the exit code under
 * `--strict`.
 */

import { defineCommand, option } from "@bunli/core";
import { existsSync } from "node:fs";
import { readFile, readlink, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { fetchManifest } from "../lib/manifest.ts";
import { activeLauncher, currentVersionPath, isCompiledBinary, stateDir, versionsDir } from "../lib/paths.ts";
import { listVersions } from "../lib/versions.ts";
import { VERSION } from "../version.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export default defineCommand({
  name: "doctor" as const,
  description: "Diagnose the ndea install (paths, symlink, versions, manifest)",
  options: {
    "check-network": option(z.coerce.boolean().default(false), {
      description: "Also probe manifest.json reachability over the network",
    }),
    strict: option(z.coerce.boolean().default(false), {
      description: "Treat soft warnings as errors (non-zero exit)",
    }),
  },
  async handler({ flags }) {
    let errors = 0;
    let warnings = 0;

    const ok = (msg: string) => console.log(`  ${GREEN}✓${RESET} ${msg}`);
    const warn = (msg: string) => {
      console.log(`  ${YELLOW}!${RESET} ${msg}`);
      warnings++;
    };
    const err = (msg: string) => {
      console.log(`  ${RED}✗${RESET} ${msg}`);
      errors++;
    };

    console.log(`\n${BOLD}ndea doctor${RESET} ${DIM}v${VERSION}${RESET}\n`);

    // ── Binary mode ────────────────────────────────────────────────────────
    console.log(`${BOLD}Mode${RESET}`);
    if (isCompiledBinary()) {
      ok(`compiled binary`);
    } else {
      warn(`running uncompiled (\`bun run\`) — install/update/rollback/gc disabled`);
    }

    // ── Path resolution ────────────────────────────────────────────────────
    const self = process.execPath;
    console.log(`\n${BOLD}Paths${RESET}`);
    console.log(`  binary       ${self}`);
    console.log(`  state dir    ${stateDir()}`);
    console.log(`  versions dir ${versionsDir()}`);

    // ── Symlink integrity ──────────────────────────────────────────────────
    // After the wrapper exec's `ndea.bin`, `process.execPath` points at the
    // binary and not the symlink. NDEA_LAUNCHER is set by the wrapper to
    // the path the user actually invoked. Missing env means the user ran
    // ndea.bin directly — supported for diagnostics (we just can't audit
    // the symlink) but explicitly flagged.
    const launcher = activeLauncher();
    if (isCompiledBinary()) {
      console.log(`\n${BOLD}Symlink${RESET}`);
      if (!launcher) {
        warn("NDEA_LAUNCHER not set — invoked ndea.bin directly; symlink not auditable");
      } else {
        const linkTarget = await readlink(launcher).catch(() => null);
        if (linkTarget) {
          ok(`${launcher} → ${linkTarget}`);
          if (!existsSync(linkTarget)) {
            err(`symlink target does not exist`);
          }
        } else {
          err(`${launcher} is not a symlink — install layout broken`);
        }
      }
    }

    // ── Sidecar dylib presence ─────────────────────────────────────────────
    // The bun-compiled binary's embedded duckdb.node loads libduckdb at
    // runtime. Without the sidecar next to ndea.bin, every command that
    // touches DuckDB (incl. `ndea view`) crashes during startup.
    if (isCompiledBinary()) {
      console.log(`\n${BOLD}DuckDB sidecar${RESET}`);
      const binaryDir = dirname(self);
      const dylibExt = process.platform === "darwin" ? "dylib" : "so";
      const dylibPath = resolve(binaryDir, `libduckdb.${dylibExt}`);
      if (existsSync(dylibPath)) {
        const info = await stat(dylibPath).catch(() => null);
        const sizeMb = info ? (info.size / (1024 * 1024)).toFixed(1) : "?";
        ok(`${dylibPath} (${sizeMb} MB)`);
      } else {
        err(`missing libduckdb.${dylibExt} next to binary — DuckDB ops will fail on launch`);
      }
    }

    // ── Active version ─────────────────────────────────────────────────────
    console.log(`\n${BOLD}Version${RESET}`);
    console.log(`  compiled-in  v${VERSION}`);
    if (existsSync(currentVersionPath())) {
      const recorded = (await readFile(currentVersionPath(), "utf8").catch(() => "")).split("\n")[0]?.trim() ?? "";
      console.log(`  recorded     ${recorded || "(unreadable)"}`);
      const recordedVersion = recorded.replace(/^v/, "");
      if (recordedVersion && recordedVersion !== VERSION) {
        warn(`recorded ${recorded} doesn't match compiled-in v${VERSION} (manual install? swap pending?)`);
      }
    } else {
      warn(`no current-version file at ${currentVersionPath()}`);
    }

    // ── Installed versions ─────────────────────────────────────────────────
    console.log(`\n${BOLD}Installed versions${RESET}`);
    const versions = await listVersions(versionsDir());
    if (versions.length === 0) {
      warn(`no versions in ${versionsDir()} — \`ndea update\` will populate it`);
    } else {
      let totalBytes = 0;
      const linkTarget = launcher && isCompiledBinary() ? await readlink(launcher).catch(() => null) : null;
      const dylibExt = process.platform === "darwin" ? "dylib" : "so";
      for (const v of versions) {
        const info = await stat(v.binaryPath).catch(() => null);
        const sizeMb = info ? (info.size / (1024 * 1024)).toFixed(1) : "?";
        const marker = linkTarget === v.wrapperPath ? `${GREEN}*${RESET}` : " ";
        const sidecarPath = resolve(versionsDir(), v.tag, `libduckdb.${dylibExt}`);
        const sidecar = existsSync(sidecarPath) ? "" : ` ${YELLOW}(missing libduckdb.${dylibExt})${RESET}`;
        console.log(`  ${marker} ${v.tag.padEnd(24)} ${sizeMb} MB${sidecar}`);
        if (info) totalBytes += info.size;
      }
      console.log(`  ${DIM}(${(totalBytes / (1024 * 1024)).toFixed(1)} MB total — \`ndea gc\` to prune)${RESET}`);
    }

    // ── Network (optional) ─────────────────────────────────────────────────
    if (flags["check-network"]) {
      console.log(`\n${BOLD}Network${RESET}`);
      try {
        const channel = (process.env.NDEA_CHANNEL ?? "stable") as "stable" | "latest" | "pre-release" | "canary";
        const asset = await Promise.race([
          fetchManifest(channel),
          new Promise<never>((_, rej) => {
            setTimeout(() => {
              rej(new Error("timeout"));
            }, 3000);
          }),
        ]);
        ok(`manifest "${channel}" → ${asset.tag}`);
      } catch (e) {
        warn(`manifest unreachable: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ── Summary ────────────────────────────────────────────────────────────
    console.log("");
    if (errors > 0) {
      console.log(`${RED}${errors} error(s)${RESET}, ${warnings} warning(s)`);
      process.exit(1);
    } else if (warnings > 0 && flags.strict) {
      console.log(`${YELLOW}${warnings} warning(s)${RESET} (--strict)`);
      process.exit(1);
    } else if (warnings > 0) {
      console.log(`${YELLOW}${warnings} warning(s)${RESET} — ${DIM}use --strict to fail on warnings${RESET}`);
    } else {
      console.log(`${GREEN}healthy${RESET}`);
    }
  },
});
