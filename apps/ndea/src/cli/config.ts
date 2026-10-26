/**
 * YAML project config loader.
 *
 * Supports multi-dataset project files grouped into collections, with
 * optional obs columns, channel configs, and server settings. Single zarr
 * paths are also handled via `pathsToConfig()`.
 */

import { existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DatasetChannelConfig } from "../server/state.ts";
import { defaultWorkspacePath } from "../env/paths.ts";

// ─── Public types ───────────────────────────────────────────────────────────

export interface ProjectDatasetMount {
  name: string;
  path: string;
  platePath?: string;
  channels?: Record<string, DatasetChannelConfig>;
}

/** Datasets one server run opens together; a run serves one collection (`--collection`). */
export interface ProjectCollection {
  name: string;
  datasets: ProjectDatasetMount[];
}

export interface ParsedProjectConfig {
  datasets: ProjectDatasetMount[];
  /** Declared collections, then the implicit one (named after the project) holding datasets in none. */
  collections: ProjectCollection[];
  settings?: {
    port?: number;
    host?: string;
  };
  /** Preset a new workspace file starts from (top-level YAML `preset:`): a built-in name or a .json document. */
  preset?: string;
}

/** Fully resolved config with CLI overrides applied. */
export interface LaunchConfig {
  collections: ProjectCollection[];
  /** The collection this run opens. */
  collection: string;
  port: number;
  host: string;
  noOpen: boolean;
  /** Serve the frontend source through Bun's dev server (HMR) instead of the built bundle. */
  dev: boolean;
  /** Show the live status screen instead of log output once ready (interactive terminals only). */
  tui?: boolean;
  preset?: string;
  /** Absolute path of the workspace document file. */
  workspace: string;
}

export interface LaunchOverrides {
  /** Collection to open; defaults to the first. */
  collection?: string;
  port?: number;
  host?: string;
  noOpen: boolean;
  dev: boolean;
  tui?: boolean;
  preset?: string;
  /** Workspace file; defaults to `defaultWorkspacePath(datasets)`. */
  workspace?: string;
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

  const collections = parseCollections(raw.collections, datasets, basename(absPath, extname(absPath)));
  const settings = parseSettings(raw.settings);
  const preset = typeof raw.preset === "string" ? raw.preset : undefined;

  return { datasets, collections, settings, preset };
}

// ─── Path-based config ──────────────────────────────────────────────────────

/**
 * Convert bare zarr paths into a ParsedProjectConfig.
 *
 * Each path becomes a dataset whose name is derived from the filename; together they are one collection.
 */
export function pathsToConfig(paths: string[]): ParsedProjectConfig {
  const datasets: ProjectDatasetMount[] = paths.map((p) => {
    const abs = resolve(p);
    // Derive name: strip trailing slashes, take basename, drop .zarr extension
    const base = abs.replace(/\/+$/, "").split("/").pop()!;
    const name = base.replace(/\.zarr$/, "");
    return { name, path: abs };
  });
  return { datasets, collections: [{ name: datasets.map((d) => d.name).join(" + "), datasets }] };
}

/** Apply CLI overrides to a parsed project without changing boundary precedence. */
export function resolveLaunchConfig(project: ParsedProjectConfig, overrides: LaunchOverrides): LaunchConfig {
  const names = project.collections.map((c) => c.name);
  const collection = overrides.collection ?? names[0];
  if (!names.includes(collection)) {
    throw new Error(`unknown collection '${collection}' (collections: ${names.join(", ")})`);
  }
  return {
    collections: project.collections,
    collection,
    port: overrides.port ?? project.settings?.port ?? 5055,
    host: overrides.host ?? project.settings?.host ?? "127.0.0.1",
    noOpen: overrides.noOpen,
    dev: overrides.dev,
    tui: overrides.tui,
    preset: overrides.preset ?? project.preset,
    // Every dataset of the project, so all collections share one workspace file.
    workspace: overrides.workspace
      ? resolve(overrides.workspace)
      : defaultWorkspacePath(project.datasets.map((dataset) => dataset.path)),
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

/**
 * `collections:` as an array of `{ name, datasets }` or a map of name → `{ datasets }`; datasets
 * named by any collection may appear in several. Datasets in none form a trailing implicit
 * collection named `implicitName` (all of them when `collections:` is absent).
 */
function parseCollections(
  raw: unknown,
  datasets: readonly ProjectDatasetMount[],
  implicitName: string,
): ProjectCollection[] {
  if (raw != null && typeof raw !== "object") throw new TypeError("'collections' must be an array or object");
  const entries: [unknown, unknown, string][] = Array.isArray(raw)
    ? raw.map((entry: unknown, i) => {
        const e = (entry ?? {}) as Record<string, unknown>;
        return [e.name, e.datasets, `Collection entry ${i}`];
      })
    : Object.entries((raw ?? {}) as Record<string, unknown>).map(([name, e]) => [
        name,
        (e as Record<string, unknown> | null)?.datasets,
        `Collection '${name}'`,
      ]);
  const byName = new Map(datasets.map((dataset) => [dataset.name, dataset]));
  const collections = entries.map(([name, members, owner]): ProjectCollection => {
    if (typeof name !== "string" || !name) throw new Error(`${owner} must have a 'name' string`);
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error(`${owner} must list its datasets: datasets: [<dataset name>, ...]`);
    }
    if (new Set(members).size !== members.length) throw new Error(`${owner} lists a dataset twice`);
    return {
      name,
      datasets: members.map((member: unknown) => {
        const dataset = typeof member === "string" ? byName.get(member) : undefined;
        if (!dataset) {
          throw new Error(
            `${owner}: unknown dataset ${JSON.stringify(member)} (datasets: ${[...byName.keys()].join(", ")})`,
          );
        }
        return dataset;
      }),
    };
  });
  const listed = new Set(collections.flatMap((c) => c.datasets));
  const rest = datasets.filter((dataset) => !listed.has(dataset));
  if (rest.length > 0) collections.push({ name: implicitName, datasets: rest });
  const names = collections.map((c) => c.name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate !== undefined) {
    throw new Error(
      duplicate === implicitName && rest.length > 0
        ? `Collection '${duplicate}' clashes with the implicit collection of datasets in no collection (${rest.map((d) => d.name).join(", ")})`
        : `Collection '${duplicate}' is defined twice`,
    );
  }
  return collections;
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
