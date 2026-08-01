import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Channel } from "./releases.ts";

export const MISE_TOOL_ID = "github:czbiohub-sf/nd-embedding-atlas";

interface MiseSource {
  path?: unknown;
}

export interface MiseLsEntry {
  active?: unknown;
  install_path?: unknown;
  installed?: unknown;
  requested_version?: unknown;
  source?: unknown;
  version?: unknown;
}

/**
 * A mise-managed install seen from two angles: the entry that owns the running
 * binary, and the entry mise currently activates. The two diverge whenever the
 * pin moved after this process was launched.
 */
export interface MiseInstallManager {
  kind: "mise";
  /** Whether the running binary is the version mise currently activates. */
  active: boolean;
  /** Install directory of the running binary. */
  installPath: string;
  /** mise's version string for the running binary. */
  version: string | null;
  /** Config file that activates the tool, read off the active entry. */
  sourceConfig: string | null;
  /** `requested_version` on the active entry: an exact pin, or `latest`. */
  requestedVersion: string | null;
  /** Version mise activates now; differs from `version` when this binary is stale. */
  activeVersion: string | null;
}

export interface InstallerInstallManager {
  kind: "installer";
}

export type InstallManager = MiseInstallManager | InstallerInstallManager;

export interface CommandResult {
  exitCode: number;
  stdout: string;
}

export type CommandRunner = (command: readonly string[]) => Promise<CommandResult>;

export function parseMiseSourcePath(entry: MiseLsEntry): string | null {
  if (!entry.source || typeof entry.source !== "object") return null;
  const path = (entry.source as MiseSource).path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

export function parseMiseLsJson(output: string): MiseLsEntry[] {
  const parsed: unknown = JSON.parse(output);
  if (Array.isArray(parsed)) return parsed.filter(isMiseLsEntry);
  if (!parsed || typeof parsed !== "object") return [];

  const entries = (parsed as Record<string, unknown>)[MISE_TOOL_ID];
  return Array.isArray(entries) ? entries.filter(isMiseLsEntry) : [];
}

/**
 * Locate the mise install that owns `execPath`, plus the tool's active config.
 *
 * The config is read off whichever entry mise marks active, which need not be
 * the entry holding `execPath`: after a pin moves, the previously active
 * install keeps its directory but loses `active` and `source`. Reading the
 * config off the owning entry would then report the tool as unconfigured while
 * a perfectly good config is active.
 */
export function findMiseInstall(output: string, execPath: string): MiseInstallManager | null {
  let entries: MiseLsEntry[];
  try {
    entries = parseMiseLsJson(output);
  } catch {
    return null;
  }

  const owner = entries.find(
    (entry) => typeof entry.install_path === "string" && pathContains(entry.install_path, execPath),
  );
  if (!owner || typeof owner.install_path !== "string") return null;

  const configured = entries.find((entry) => entry.active === true && parseMiseSourcePath(entry) !== null);
  const active = configured ?? entries.find((entry) => entry.active === true) ?? owner;

  return {
    kind: "mise",
    active: owner.active === true,
    installPath: owner.install_path,
    version: asString(owner.version),
    sourceConfig: parseMiseSourcePath(active),
    requestedVersion: asString(active.requested_version),
    activeVersion: asString(active.version),
  };
}

export function miseUseArgs(
  sourceConfig: string,
  tag: string,
  channel: Channel,
  requestedVersion: string | null,
  force: boolean,
): string[] {
  const preserveLatest = channel !== "pre-release" && requestedVersion === "latest";
  const args = ["mise", "use", "--path", sourceConfig];
  if (!preserveLatest) args.push("--pin");
  args.push(`${MISE_TOOL_ID}@${preserveLatest ? "latest" : tag.replace(/^v/, "")}`);
  if (force) args.push("--force");
  return args;
}

export async function detectInstallManager(
  execPath = process.execPath,
  run: CommandRunner = runCommand,
): Promise<InstallManager> {
  const result = await run(["mise", "ls", "--json", MISE_TOOL_ID]).catch(() => null);
  if (result?.exitCode === 0) {
    const install = findMiseInstall(result.stdout, execPath);
    if (install) return install;
  }
  if (looksLikeMiseInstallPath(execPath)) {
    return {
      kind: "mise",
      active: false,
      installPath: dirname(resolve(execPath)),
      version: null,
      sourceConfig: null,
      requestedVersion: null,
      activeVersion: null,
    };
  }
  return { kind: "installer" };
}

export async function runMiseUse(
  sourceConfig: string,
  tag: string,
  channel: Channel,
  requestedVersion: string | null,
  force: boolean,
): Promise<number> {
  const proc = Bun.spawn(miseUseArgs(sourceConfig, tag, channel, requestedVersion, force), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

async function runCommand(command: readonly string[]): Promise<CommandResult> {
  const proc = Bun.spawn([...command], { stdout: "pipe", stderr: "ignore" });
  const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return { exitCode, stdout };
}

function isMiseLsEntry(value: unknown): value is MiseLsEntry {
  return value !== null && typeof value === "object";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function looksLikeMiseInstallPath(execPath: string): boolean {
  return resolve(execPath).split(sep).includes("github-czbiohub-sf-nd-embedding-atlas");
}

export function pathContains(parent: string, child: string): boolean {
  const from = canonicalPath(parent);
  const to = canonicalPath(child);
  const nested = relative(from, to);
  return nested.length > 0 && nested !== ".." && !nested.startsWith(`..${sep}`) && !isAbsolute(nested);
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
