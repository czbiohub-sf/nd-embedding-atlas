/**
 * `ndea self doctor`: read-only diagnostics. Prints binary path, symlink
 * integrity, active version, installed versions, remote-render
 * prerequisites, and (with `--check-network`) GitHub Releases API
 * reachability.
 *
 * Exit code 0 if healthy; 1 if a hard anomaly is detected (broken symlink,
 * unreadable state, missing active binary). Soft warnings (mismatched
 * current-version vs compiled-in tag) only bump the exit code under
 * `--strict`. Remote rendering is optional, so its findings never count.
 */

import { defineCommand } from "@crustjs/core";
import { existsSync } from "node:fs";
import { readFile, readlink, stat } from "node:fs/promises";
import { detectInstallManager } from "../lib/install-manager.ts";
import { LIBDUCKDB_EMBEDDED_PATH } from "../lib/__generated-libduckdb.ts";
import { libduckdbCachePath } from "../lib/libduckdb-cache.ts";
import { activeLauncher, currentVersionPath, isCompiledBinary, stateDir, versionsDir } from "../lib/paths.ts";
import { fetchRelease } from "../lib/releases.ts";
import { accent, fail, heading, label, mb, ok, warn } from "../lib/style.ts";
import { listVersions } from "../lib/versions.ts";
import { VERSION } from "../version.ts";
import { probeChrome } from "../../server/chrome.ts";

export default defineCommand(
  "doctor",
  { description: "Diagnose the ndea install (paths, manager, versions, releases)" },
  (command) =>
    command
      .flags(
        {
          name: "check-network",
          type: "boolean",
          default: false,
          description: "Also probe GitHub Releases API reachability over the network",
        },
        {
          name: "strict",
          type: "boolean",
          default: false,
          description: "Treat soft warnings as errors (non-zero exit)",
        },
      )
      .action(async ({ flags, stdout }) => {
        let errors = 0;
        let warnings = 0;

        const pass = (msg: string) => stdout(`  ${ok(msg)}`);
        const soft = (msg: string) => {
          stdout(`  ${warn(msg)}`);
          warnings++;
        };
        const hard = (msg: string) => {
          stdout(`  ${fail(msg)}`);
          errors++;
        };
        const section = (title: string) => stdout(`\n${heading(title)}`);
        const row = (name: string, value: string) => stdout(`  ${label(name.padEnd(12))} ${value}`);

        stdout(`\n${accent("ndea")} ${heading("self doctor")} ${label(`v${VERSION}`)}`);

        // ── Binary mode ────────────────────────────────────────────────────────
        section("Mode");
        const compiled = isCompiledBinary();
        const manager = compiled ? await detectInstallManager() : { kind: "installer" as const };
        if (compiled) {
          pass("compiled binary");
          pass(`managed by ${manager.kind}`);
        } else {
          soft("running from source: self update/prune disabled");
        }

        // Windows installs are a single ndea.exe on PATH: no versions tree and no
        // symlink, so the layout audits below have nothing to inspect there.
        const isWindows = process.platform === "win32";

        // ── Path resolution ────────────────────────────────────────────────────
        section("Paths");
        row("binary", process.execPath);
        if (manager.kind === "mise") {
          row("mise install", manager.installPath);
          if (manager.sourceConfig) {
            row("mise config", manager.sourceConfig);
          } else {
            soft(
              "mise install has no active source config; activate it with `mise use -g github:czbiohub-sf/nd-embedding-atlas`",
            );
          }
        } else if (isWindows) {
          row("state dir", stateDir());
          stdout(`  ${label("(no versions tree on Windows: re-run install.ps1 to upgrade)")}`);
        } else {
          row("state dir", stateDir());
          row("versions dir", versionsDir());
        }

        // ── Symlink integrity ──────────────────────────────────────────────────
        // `activeLauncher()` checks whether ~/.local/bin/ndea resolves to
        // `process.execPath`. Missing means the binary was invoked
        // directly (not via the installed symlink): supported for
        // diagnostics, just can't audit the symlink layout.
        //
        // Skipped entirely on Windows: install.ps1 drops a single ndea.exe on
        // PATH, so there is no link to resolve and warning about one would
        // report a healthy install as broken (and fail `--strict`).
        const launcher = manager.kind === "installer" && !isWindows ? activeLauncher() : null;
        if (compiled && manager.kind === "installer" && !isWindows) {
          section("Symlink");
          if (!launcher) {
            soft("no `ndea` symlink on $PATH resolves to this binary: symlink not auditable");
          } else {
            const linkTarget = await readlink(launcher).catch(() => null);
            if (linkTarget) {
              pass(`${launcher} → ${linkTarget}`);
              if (!existsSync(linkTarget)) hard("symlink target does not exist");
            } else {
              hard(`${launcher} is not a symlink: install layout broken`);
            }
          }
        }

        // ── Embedded libduckdb cache ───────────────────────────────────────────
        // Targets that embed libduckdb extract it to ~/.cache/ndea/<version>/
        // on first launch. A missing cache file is fine (gets re-extracted on
        // next launch); we just report presence here so users know where the
        // 100+ MB went. darwin-arm64 links DuckDB statically into duckdb.node
        // and embeds no libduckdb, so there is nothing to report.
        if (compiled && LIBDUCKDB_EMBEDDED_PATH !== null) {
          section("libduckdb cache");
          const dylibPath = libduckdbCachePath();
          if (existsSync(dylibPath)) {
            const info = await stat(dylibPath).catch(() => null);
            pass(`${dylibPath} ${label(`(${info ? mb(info.size) : "? MB"})`)}`);
          } else {
            soft(`${dylibPath} not yet extracted: will populate on next DuckDB-using command`);
          }
        }

        // ── Active version ─────────────────────────────────────────────────────
        section("Version");
        row("compiled-in", `v${VERSION}`);
        if (manager.kind === "mise") {
          row("mise", manager.activeVersion ?? "(unknown)");
          if (!manager.active) {
            soft(
              `this binary is ${manager.version ?? "an inactive version"}, but mise activates ` +
                `${manager.activeVersion ?? "another version"}; open a new shell or run \`hash -r\``,
            );
          }
        } else if (existsSync(currentVersionPath())) {
          const recorded = (await readFile(currentVersionPath(), "utf8").catch(() => "")).split("\n")[0]?.trim() ?? "";
          row("recorded", recorded || "(unreadable)");
          const recordedVersion = recorded.replace(/^v/, "");
          if (recordedVersion && recordedVersion !== VERSION) {
            soft(`recorded ${recorded} doesn't match compiled-in v${VERSION} (manual install? swap pending?)`);
          }
        } else {
          soft(`no current-version file at ${currentVersionPath()}`);
        }

        // ── Installed versions ─────────────────────────────────────────────────
        if (manager.kind === "installer" && !isWindows) {
          section("Installed versions");
          const versions = await listVersions(versionsDir());
          if (versions.length === 0) {
            soft(`no versions in ${versionsDir()}: \`ndea self update\` will populate it`);
          } else {
            let totalBytes = 0;
            const linkTarget = launcher && compiled ? await readlink(launcher).catch(() => null) : null;
            for (const v of versions) {
              const info = await stat(v.binaryPath).catch(() => null);
              const marker = linkTarget === v.binaryPath ? accent("*") : " ";
              stdout(`  ${marker} ${v.tag.padEnd(24)} ${label(info ? mb(info.size) : "? MB")}`);
              if (info) totalBytes += info.size;
            }
            stdout(`  ${label(`(${mb(totalBytes)} total: \`ndea self prune\` to prune)`)}`);
          }
        }

        // ── Remote render (optional: never affects the exit code) ───────────────
        // Launches headless Chrome once and asks it what a render page would get.
        section("Remote render");
        try {
          const probe = await probeChrome();
          row("chrome", `${probe.version} ${label(probe.path)}`);
          const software = probe.webgl === null || /swiftshader|llvmpipe|software/i.test(probe.webgl);
          stdout(`  ${(software ? warn : ok)(`webgl2 ${probe.webgl ?? "unavailable"}${software ? " (no GPU)" : ""}`)}`);
          for (const [codec, support] of Object.entries(probe.encoders)) {
            stdout(`  ${(support === "unsupported" ? warn : ok)(`encode ${codec} ${support}`)}`);
          }
        } catch (e) {
          stdout(`  ${warn(`unavailable: ${e instanceof Error ? e.message : String(e)}`)}`);
        }

        // ── Network (optional) ─────────────────────────────────────────────────
        if (flags["check-network"]) {
          section("Network");
          try {
            const channel = "stable";
            const asset = await Promise.race([
              fetchRelease(channel),
              new Promise<never>((_, rej) => {
                setTimeout(() => {
                  rej(new Error("timeout"));
                }, 3000);
              }),
            ]);
            pass(`release "${channel}" → ${asset.tag}`);
          } catch (e) {
            soft(`release API unreachable: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // ── Summary ────────────────────────────────────────────────────────────
        stdout("");
        if (errors > 0) throw new Error(`${errors} error(s), ${warnings} warning(s)`);
        if (warnings > 0 && flags.strict) throw new Error(`${warnings} warning(s) (--strict)`);
        if (warnings > 0) stdout(`${warn(`${warnings} warning(s)`)} ${label("use --strict to fail on warnings")}`);
        else stdout(ok("healthy"));
      }),
);
