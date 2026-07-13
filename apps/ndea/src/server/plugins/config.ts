import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { stateDir } from "../../cli/lib/paths.ts";

export const PLUGIN_CONFIG_SCHEMA_VERSION = 1 as const;

export const PluginConfigPathSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      normalizePluginConfigPath(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: errorMessage(error),
      });
    }
  })
  .transform(normalizePluginConfigPath);

export const PluginConfigEntrySchema = z.strictObject({
  path: PluginConfigPathSchema,
  enabled: z.boolean(),
});
export type PluginConfigEntry = z.infer<typeof PluginConfigEntrySchema>;

export const PluginConfigSchema = z.strictObject({
  schemaVersion: z.literal(PLUGIN_CONFIG_SCHEMA_VERSION),
  entries: z.array(PluginConfigEntrySchema),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

export function pluginDirectory(root = stateDir()): string {
  return resolve(root, "plugins");
}

export function pluginConfigPath(root = stateDir()): string {
  return resolve(pluginDirectory(root), "config.json");
}

export function pluginPackagesPath(root = stateDir()): string {
  return resolve(pluginDirectory(root), "packages");
}

/** Validate and normalize the relative path persisted in user plugin config. */
export function normalizePluginConfigPath(input: string): string {
  if (!input || input.includes("\0")) throw new Error("plugin path must be a non-empty path without NUL bytes");
  if (isAbsolute(input)) throw new Error("plugin path must be relative to the user plugin packages directory");
  if (input.includes("\\")) throw new Error("plugin path must use forward slashes");

  const segments = input.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error("plugin path must not escape the user plugin packages directory");
  }
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  return normalized || ".";
}

export function parsePluginConfig(value: unknown): PluginConfig {
  return PluginConfigSchema.parse(value);
}

/** Read and validate config. A missing file means the empty version-1 config. */
export async function readPluginConfig(root = stateDir()): Promise<PluginConfig> {
  const path = pluginConfigPath(root);
  try {
    return parsePluginConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (isMissingFile(error)) return { schemaVersion: PLUGIN_CONFIG_SCHEMA_VERSION, entries: [] };
    throw new Error(`Invalid plugin config at ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Validate then atomically replace config with a same-directory temp file.
 * An existing malformed or future-version config is never overwritten.
 */
export async function writePluginConfig(config: PluginConfig, root = stateDir()): Promise<void> {
  const parsed = parsePluginConfig(config);
  const path = pluginConfigPath(root);
  await assertExistingConfigReadable(path);
  await mkdir(pluginDirectory(root), { recursive: true });

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/** Resolve an enabled user entry and prove its real path remains in packages/. */
export async function resolveUserPluginPath(entryPath: string, root = stateDir()): Promise<string> {
  const normalized = normalizePluginConfigPath(entryPath);
  const packages = pluginPackagesPath(root);
  const candidate = resolve(packages, ...normalized.split("/"));
  const lexicalRelative = relative(packages, candidate);
  if (!isContainedRelativePath(lexicalRelative)) {
    throw new Error("plugin path escapes the user plugin packages directory");
  }

  const [realStateRoot, realPluginDirectory, realPackages, realCandidate] = await Promise.all([
    realpath(root),
    realpath(pluginDirectory(root)),
    realpath(packages),
    realpath(candidate),
  ]);
  if (!isContainedRelativePath(relative(realStateRoot, realPluginDirectory))) {
    throw new Error("user plugin directory resolves outside the state directory");
  }
  if (!isContainedRelativePath(relative(realPluginDirectory, realPackages))) {
    throw new Error("user plugin packages directory resolves outside the plugin directory");
  }
  const canonicalRelative = relative(realPackages, realCandidate);
  if (!isContainedRelativePath(canonicalRelative)) {
    throw new Error("plugin path resolves outside the user plugin packages directory");
  }
  return realCandidate;
}

export async function resolveEnabledUserPluginPaths(config: PluginConfig, root = stateDir()): Promise<string[]> {
  const parsed = parsePluginConfig(config);
  const paths: string[] = [];
  for (const entry of parsed.entries) {
    if (entry.enabled) paths.push(await resolveUserPluginPath(entry.path, root));
  }
  return paths;
}

function isContainedRelativePath(value: string): boolean {
  return value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value);
}

async function assertExistingConfigReadable(path: string): Promise<void> {
  try {
    await access(path, constants.F_OK);
  } catch (error) {
    if (isMissingFile(error)) return;
    throw error;
  }
  try {
    parsePluginConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(`Refusing to overwrite invalid plugin config at ${path}: ${errorMessage(error)}`, { cause: error });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
