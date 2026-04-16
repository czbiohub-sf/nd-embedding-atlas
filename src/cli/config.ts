/**
 * YAML project config loader.
 *
 * Supports multi-dataset project files with optional obs columns,
 * channel configs, and server settings. Single zarr paths are also
 * handled via `pathsToConfig()`.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChannelConfig } from "../server/state.ts";

// ─── Public types ───────────────────────────────────────────────────────────

export interface DatasetEntry {
    name: string;
    path: string;
    platePath?: string;
    channels?: Record<string, ChannelConfig>;
}

export interface ProjectConfig {
    datasets: DatasetEntry[];
    obsColumns?: string[];
    settings?: {
        port?: number;
        host?: string;
    };
}

/** Fully resolved config with CLI overrides applied. */
export interface ResolvedConfig {
    datasets: DatasetEntry[];
    obsColumns?: string[];
    port: number;
    host: string;
    noOpen: boolean;
    noStatic: boolean;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/** True if the path looks like a YAML config file. */
export function isYamlConfig(path: string): boolean {
    return path.endsWith(".yaml") || path.endsWith(".yml");
}

// ─── YAML loader ────────────────────────────────────────────────────────────

/** Load and validate a YAML project config. Paths are resolved relative to the YAML file. */
export async function loadProjectConfig(yamlPath: string): Promise<ProjectConfig> {
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

    return { datasets, obsColumns, settings };
}

// ─── Path-based config ──────────────────────────────────────────────────────

/**
 * Convert bare zarr paths into a ProjectConfig.
 *
 * Each path becomes a dataset whose name is derived from the filename.
 */
export function pathsToConfig(paths: string[]): ProjectConfig {
    const datasets: DatasetEntry[] = paths.map((p) => {
        const abs = resolve(p);
        // Derive name: strip trailing slashes, take basename, drop .zarr extension
        const base = abs.replace(/\/+$/, "").split("/").pop()!;
        const name = base.replace(/\.zarr$/, "");
        return { name, path: abs };
    });
    return { datasets };
}

// ─── Internal parsers ───────────────────────────────────────────────────────

function parseDatasets(raw: unknown, baseDir: string): DatasetEntry[] {
    if (!Array.isArray(raw)) {
        throw new Error("Config 'datasets' must be an array");
    }

    return raw.map((entry: unknown, i: number) => {
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

        const dataset: DatasetEntry = {
            name: e.name,
            path: resolve(baseDir, e.path),
        };

        if (e.plate_path != null) {
            if (typeof e.plate_path !== "string") {
                throw new Error(`Dataset entry ${i}: plate_path must be a string`);
            }
            dataset.platePath = resolve(baseDir, e.plate_path);
        }

        if (e.channels != null) {
            dataset.channels = parseChannels(e.channels, i);
        }

        return dataset;
    });
}

function parseChannels(raw: unknown, datasetIndex: number): Record<string, ChannelConfig> {
    if (!raw || typeof raw !== "object") {
        throw new Error(`Dataset ${datasetIndex}: channels must be an object`);
    }

    const result: Record<string, ChannelConfig> = {};
    for (const [name, cfg] of Object.entries(raw as Record<string, unknown>)) {
        if (!cfg || typeof cfg !== "object") {
            throw new Error(`Dataset ${datasetIndex}, channel '${name}': expected an object`);
        }
        const c = cfg as Record<string, unknown>;
        if (typeof c.color !== "string") {
            throw new Error(`Dataset ${datasetIndex}, channel '${name}': color must be a string`);
        }
        const channel: ChannelConfig = { color: c.color };

        if (c.contrast != null) {
            if (!Array.isArray(c.contrast) || c.contrast.length !== 2) {
                throw new Error(`Dataset ${datasetIndex}, channel '${name}': contrast must be [min, max]`);
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
        throw new Error("'obs_columns' must be an array of strings");
    }
    for (const item of raw) {
        if (typeof item !== "string") {
            throw new Error(`obs_columns entries must be strings, got: ${typeof item}`);
        }
    }
    return raw as string[];
}

function parseSettings(raw: unknown): ProjectConfig["settings"] | undefined {
    if (raw == null) return undefined;
    if (typeof raw !== "object") {
        throw new Error("'settings' must be an object");
    }
    const s = raw as Record<string, unknown>;
    const result: ProjectConfig["settings"] = {};

    if (s.port != null) {
        if (typeof s.port !== "number" || !Number.isInteger(s.port)) {
            throw new Error("settings.port must be an integer");
        }
        result.port = s.port;
    }
    if (s.host != null) {
        if (typeof s.host !== "string") {
            throw new Error("settings.host must be a string");
        }
        result.host = s.host;
    }

    return result;
}
