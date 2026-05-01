/**
 * `ndea view` — open zarr stores and serve the dashboard.
 *
 * This is the default command: `ndea ./data.zarr` routes here via the root
 * command's `run` fallback so pre-subcommand invocations keep working.
 */

import { defineCommand } from "citty";
import { isYamlConfig, loadProjectConfig, pathsToConfig } from "../config.ts";
import type { ResolvedConfig } from "../config.ts";
import { validateZarrPath } from "../resolve.ts";
import { startup } from "../startup.ts";

export default defineCommand({
  meta: {
    name: "view",
    description: "Open one or more zarr stores in the browser dashboard",
  },
  args: {
    paths: {
      type: "positional",
      description: "Zarr stores or a YAML project config",
      required: false,
    },
    port: {
      type: "string",
      description: "Server port (default: 5055)",
    },
    host: {
      type: "string",
      description: "Server host (default: localhost)",
    },
    "no-open": {
      type: "boolean",
      description: "Do not auto-open the browser",
    },
    "no-static": {
      type: "boolean",
      description: "Do not serve the frontend bundle (dev mode)",
    },
    "obs-columns": {
      type: "string",
      description: "Comma-separated obs columns to include",
    },
  },
  async run({ args }) {
    // The pending-update auto-applier runs at the root in `index.ts` so every
    // command picks up a freshly-staged binary. We keep no second call here
    // to avoid double-checking the marker on every `ndea view` invocation.

    // Positional args first; fall back to NDEA_DATASET env var. The env var
    // is how `vp run --parallel dev:all` forwards the dataset path to this
    // task (vp's dependsOn chain can't forward positional args).
    let paths = extractPaths(args);
    if (paths.length === 0 && typeof process.env.NDEA_DATASET === "string" && process.env.NDEA_DATASET.length > 0) {
      paths = [process.env.NDEA_DATASET];
    }
    if (paths.length === 0) {
      console.error("Error: at least one path is required.\n");
      console.error("Run 'ndea view --help' for usage, or set NDEA_DATASET.");
      process.exit(1);
    }

    const port = parsePort(args.port);
    const host = typeof args.host === "string" && args.host.length > 0 ? args.host : undefined;
    const noOpen = args["no-open"] === true;
    // citty silently drops `--no-*` CLI flags, so mirror NDEA_NO_OPEN's env-var
    // escape hatch. scripts/dev.ts sets NDEA_NO_STATIC=1 before spawning.
    const noStatic = args["no-static"] === true || process.env.NDEA_NO_STATIC === "1";
    const obsColumns = parseObsColumns(args["obs-columns"]);

    const config = await resolveConfig({ paths, port, host, noOpen, noStatic, obsColumns });

    try {
      await startup(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\nFatal error during startup: ${msg}`);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

interface RawArgs {
  paths: string[];
  port?: number;
  host?: string;
  noOpen: boolean;
  noStatic: boolean;
  obsColumns?: string[];
}

function extractPaths(args: Record<string, unknown>): string[] {
  // Citty exposes positional args both under their declared name (`paths`)
  // and inside the raw `_` tail. We merge both so multi-positional works.
  const named = args.paths;
  const list: string[] = [];
  if (typeof named === "string" && named.length > 0) list.push(named);
  const rest = (args as { _?: unknown })._;
  if (Array.isArray(rest)) {
    for (const entry of rest) {
      if (typeof entry === "string" && entry.length > 0 && entry !== named) list.push(entry);
    }
  }
  return list;
}

function parsePort(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const asText = typeof raw === "string" || typeof raw === "number" ? String(raw) : "<non-scalar>";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Error: invalid port number: ${asText}`);
    process.exit(1);
  }
  return port;
}

function parseObsColumns(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const cols = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cols.length > 0 ? cols : undefined;
}

async function resolveConfig(raw: RawArgs): Promise<ResolvedConfig> {
  const { paths, port, host, noOpen, noStatic, obsColumns } = raw;

  if (paths.length === 1 && isYamlConfig(paths[0])) {
    try {
      const project = await loadProjectConfig(paths[0]);
      for (const ds of project.datasets) validateZarrPath(ds.path);
      return {
        datasets: project.datasets,
        obsColumns: obsColumns ?? project.obsColumns,
        port: port ?? project.settings?.port ?? 5055,
        host: host ?? project.settings?.host ?? "localhost",
        noOpen,
        noStatic,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error loading config: ${msg}`);
      process.exit(1);
    }
  }

  try {
    for (const p of paths) validateZarrPath(p);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  const project = pathsToConfig(paths);
  return {
    datasets: project.datasets,
    obsColumns,
    port: port ?? 5055,
    host: host ?? "localhost",
    noOpen,
    noStatic,
  };
}
