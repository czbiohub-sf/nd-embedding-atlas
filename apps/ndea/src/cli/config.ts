/**
 * YAML project config loader.
 *
 * Supports multi-dataset project files with optional obs columns,
 * channel configs, and server settings. Single zarr paths are also
 * handled via `pathsToConfig()`.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DatasetChannelConfig } from "../server/state.ts";

// ─── Public types ───────────────────────────────────────────────────────────

export interface ProjectDatasetMount {
  name: string;
  path: string;
  platePath?: string;
  channels?: Record<string, DatasetChannelConfig>;
}

export interface ParsedProjectConfig {
  datasets: ProjectDatasetMount[];
  obsColumns?: string[];
  settings?: {
    port?: number;
    host?: string;
  };
  /** Named preset a shipped build opens (top-level YAML `preset:`). */
  preset?: string;
  /** Absolute plugin paths resolved from top-level YAML `plugin_paths:`. */
  pluginPaths?: string[];
}

/** Fully resolved config with CLI overrides applied. */
export interface LaunchConfig {
  datasets: ProjectDatasetMount[];
  obsColumns?: string[];
  port: number;
  host: string;
  noOpen: boolean;
  noStatic: boolean;
  preset?: string;
  pluginPaths?: string[];
}

export interface LaunchOverrides {
  port?: number;
  host?: string;
  noOpen: boolean;
  noStatic: boolean;
  obsColumns?: string[];
  preset?: string;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/** True if the path looks like a YAML config file. */
export function isYamlConfig(path: string): boolean {
  return path.endsWith(".yaml") || path.endsWith(".yml");
}

// ─── YAML loader ────────────────────────────────────────────────────────────

/** Load and validate a YAML project config. Paths are resolved relative to the YAML file. */
export async function loadProjectConfig(yamlPath: string): Promise<ParsedProjectConfig> {
  const absPath = resolve(yamlPath);
  if (!existsSync(absPath)) {
    throw new Error(`Config file not found: ${absPath}`);
  }

  const text = await Bun.file(absPath).text();
  const raw = parseYaml(text) as Record<string, unknown>;

  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid YAML config: expected an object, got ${typeof raw}`);
  }

  const baseDir = dirname(absPath);
  const datasets = parseDatasets(raw.datasets, baseDir);

  if (datasets.length === 0) {
    throw new Error("Config must define at least one dataset");
  }

  const obsColumns = parseObsColumns(raw.obs_columns);
  const settings = parseSettings(raw.settings);
  const preset = typeof raw.preset === "string" ? raw.preset : undefined;
  const pluginPaths = parsePluginPaths(raw.plugin_paths, baseDir);

  return { datasets, obsColumns, settings, preset, pluginPaths };
}

// ─── Path-based config ──────────────────────────────────────────────────────

/**
 * Convert bare zarr paths into a ParsedProjectConfig.
 *
 * Each path becomes a dataset whose name is derived from the filename.
 */
export function pathsToConfig(paths: string[]): ParsedProjectConfig {
  const datasets: ProjectDatasetMount[] = paths.map((p) => {
    const abs = resolve(p);
    // Derive name: strip trailing slashes, take basename, drop .zarr extension
    const base = abs.replace(/\/+$/, "").split("/").pop()!;
    const name = base.replace(/\.zarr$/, "");
    return { name, path: abs };
  });
  return { datasets };
}

/** Apply CLI overrides to a parsed project without changing boundary precedence. */
export function resolveLaunchConfig(project: ParsedProjectConfig, overrides: LaunchOverrides): LaunchConfig {
  return {
    datasets: project.datasets,
    obsColumns: overrides.obsColumns ?? project.obsColumns,
    port: overrides.port ?? project.settings?.port ?? 5055,
    host: overrides.host ?? project.settings?.host ?? "127.0.0.1",
    noOpen: overrides.noOpen,
    noStatic: overrides.noStatic,
    preset: overrides.preset ?? project.preset,
    pluginPaths: project.pluginPaths,
  };
}

// ─── Internal parsers ───────────────────────────────────────────────────────

function parseDatasets(raw: unknown, baseDir: string): ProjectDatasetMount[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Config 'datasets' must be an array or object");
  }

  // Support both formats:
  //   Array:  [{ name, path, plate_path }]
  //   Dict:   { "dataset_name": { anndata, hcs_plate } }
  if (Array.isArray(raw)) {
    return raw.map((entry: unknown, i: number) => parseArrayEntry(entry, i, baseDir));
  }

  // Dict format: keys are dataset names, values have anndata + hcs_plate
  return Object.entries(raw as Record<string, unknown>).map(([name, entry]) => parseDictEntry(name, entry, baseDir));
}

/** Parse array-style entry: { name, path, plate_path?, channels? } */
function parseArrayEntry(entry: unknown, i: number, baseDir: string): ProjectDatasetMount {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Dataset entry ${i} must be an object`);
  }
  const e = entry as Record<string, unknown>;

  if (typeof e.name !== "string" || !e.name) {
    throw new Error(`Dataset entry ${i} must have a 'name' string`);
  }
  if (typeof e.path !== "string" || !e.path) {
    throw new Error(`Dataset entry ${i} must have a 'path' string`);
  }

  const dataset: ProjectDatasetMount = {
    name: e.name,
    path: resolve(baseDir, e.path),
  };

  if (e.plate_path != null) {
    if (typeof e.plate_path !== "string") {
      throw new TypeError(`Dataset entry ${i}: plate_path must be a string`);
    }
    dataset.platePath = resolve(baseDir, e.plate_path);
  }

  if (e.channels != null) {
    dataset.channels = parseChannels(e.channels, i);
  }

  return dataset;
}

/**
 * Parse dict-style entry: { anndata, hcs_plate?, channels? }
 *
 * This is the format used by infectomics YAML configs:
 *   datasets:
 *     "experiment_name":
 *       anndata: /path/to/anndata.zarr
 *       hcs_plate: /path/to/plate.zarr
 */
function parseDictEntry(name: string, entry: unknown, baseDir: string): ProjectDatasetMount {
  if (!entry || typeof entry !== "object") {
    throw new Error(`Dataset '${name}' must be an object`);
  }
  const e = entry as Record<string, unknown>;

  const owner = `Dataset '${name}'`;
  const dataPath = parseAliasedString(e, ["anndata", "path"], owner);
  if (!dataPath) {
    throw new Error(`Dataset '${name}' must have an 'anndata' or 'path' string`);
  }

  const dataset: ProjectDatasetMount = {
    name,
    path: resolve(baseDir, dataPath),
  };

  const platePath = parseAliasedString(e, ["hcs_plate", "ome-zarr", "ome_zarr", "plate_path"], owner);
  if (platePath != null) {
    dataset.platePath = resolve(baseDir, platePath);
  }

  if (e.channels != null) {
    dataset.channels = parseChannels(e.channels, name);
  }

  return dataset;
}

function parseAliasedString(
  record: Record<string, unknown>,
  keys: readonly string[],
  owner: string,
): string | undefined {
  const defined = keys.flatMap((key) => {
    const value = record[key];
    return value == null ? [] : [{ key, value }];
  });
  if (defined.length === 0) return undefined;

  for (const { key, value } of defined) {
    if (typeof value !== "string") {
      throw new TypeError(`${owner}: '${key}' must be a string`);
    }
  }

  const values = new Set(defined.map(({ value }) => value));
  if (values.size > 1) {
    throw new Error(`${owner}: conflicting values for ${defined.map(({ key }) => `'${key}'`).join(", ")}`);
  }

  return defined[0].value as string;
}

function parseChannels(raw: unknown, datasetId: number | string): Record<string, DatasetChannelConfig> {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Dataset ${datasetId}: channels must be an object`);
  }

  const result: Record<string, DatasetChannelConfig> = {};
  for (const [name, cfg] of Object.entries(raw as Record<string, unknown>)) {
    if (!cfg || typeof cfg !== "object") {
      throw new Error(`Dataset ${datasetId}, channel '${name}': expected an object`);
    }
    const c = cfg as Record<string, unknown>;
    if (typeof c.color !== "string") {
      throw new TypeError(`Dataset ${datasetId}, channel '${name}': color must be a string`);
    }
    const channel: DatasetChannelConfig = { color: c.color };

    if (c.contrast != null) {
      if (!Array.isArray(c.contrast) || c.contrast.length !== 2) {
        throw new Error(`Dataset ${datasetId}, channel '${name}': contrast must be [min, max]`);
      }
      channel.contrast = c.contrast as [number, number];
    }
    if (c.visible != null) {
      channel.visible = Boolean(c.visible);
    }

    result[name] = channel;
  }
  return result;
}

function parseObsColumns(raw: unknown): string[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new TypeError("'obs_columns' must be an array of strings");
  }
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new TypeError(`obs_columns entries must be strings, got: ${typeof item}`);
    }
  }
  return raw as string[];
}

function parseSettings(raw: unknown): ParsedProjectConfig["settings"] | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") {
    throw new TypeError("'settings' must be an object");
  }
  const s = raw as Record<string, unknown>;
  const result: ParsedProjectConfig["settings"] = {};

  if (s.port != null) {
    if (typeof s.port !== "number" || !Number.isInteger(s.port)) {
      throw new TypeError("settings.port must be an integer");
    }
    result.port = s.port;
  }
  if (s.host != null) {
    if (typeof s.host !== "string") {
      throw new TypeError("settings.host must be a string");
    }
    result.host = s.host;
  }

  return result;
}

function parsePluginPaths(raw: unknown, baseDir: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new TypeError("'plugin_paths' must be an array of relative path strings");
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new TypeError(`plugin_paths entry ${index} must be a string`);
    }
    if (entry.length === 0) {
      throw new Error(`plugin_paths entry ${index} must not be empty`);
    }
    if (entry.includes("\0")) {
      throw new Error(`plugin_paths entry ${index} must not contain NUL`);
    }
    if (isAbsolute(entry)) {
      throw new Error(`plugin_paths entry ${index} must be relative`);
    }

    const pluginPath = resolve(baseDir, entry);
    const relativePath = relative(baseDir, pluginPath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error(`plugin_paths entry ${index} escapes the project directory`);
    }
    return pluginPath;
  });
}
