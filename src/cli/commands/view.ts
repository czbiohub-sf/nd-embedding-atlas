/**
 * `ndea view` — open zarr stores and serve the dashboard.
 *
 * This is the default command: `ndea ./data.zarr` routes here via the root
 * argv normalizer in index.ts so pre-subcommand invocations keep working.
 */

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { isYamlConfig, loadProjectConfig, pathsToConfig } from "../config.ts";
import type { ResolvedConfig } from "../config.ts";
import { validateZarrPath } from "../resolve.ts";
import { startup } from "../startup.ts";

export default defineCommand({
  name: "view" as const,
  description: "Open one or more zarr stores (or a YAML project config) in the dashboard",
  options: {
    port: option(z.coerce.number().int().min(1).max(65535).optional(), {
      description: "Server port (default: 5055)",
    }),
    host: option(z.string().optional(), {
      description: "Server host (default: localhost)",
    }),
    "no-open": option(z.coerce.boolean().default(false), {
      description: "Do not auto-open the browser",
    }),
    "no-static": option(z.coerce.boolean().default(false), {
      description: "Do not serve the frontend bundle (dev mode)",
    }),
    "obs-columns": option(z.string().optional(), {
      description: "Comma-separated obs columns to include",
    }),
  },
  async handler({ flags, positional }) {
    // Positional args first; fall back to NDEA_DATASET env var. The env
    // var is how `vp run --parallel dev:all` forwards the dataset path
    // to this task (vp's dependsOn chain can't forward positional args).
    let paths = positional.filter((p) => p.length > 0);
    if (paths.length === 0 && typeof process.env.NDEA_DATASET === "string" && process.env.NDEA_DATASET.length > 0) {
      paths = [process.env.NDEA_DATASET];
    }
    if (paths.length === 0) {
      console.error("Error: at least one path is required.\n");
      console.error("Run 'ndea view --help' for usage, or set NDEA_DATASET.");
      process.exit(1);
    }

    const port = flags.port;
    const host = flags.host && flags.host.length > 0 ? flags.host : undefined;
    const noOpen = flags["no-open"];
    // Mirror the env-var escape hatch — scripts/dev.ts sets NDEA_NO_STATIC=1.
    const noStatic = flags["no-static"] || process.env.NDEA_NO_STATIC === "1";
    const obsColumns = parseObsColumns(flags["obs-columns"]);

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

function parseObsColumns(raw: string | undefined): string[] | undefined {
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
