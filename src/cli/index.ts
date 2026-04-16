#!/usr/bin/env bun

/**
 * ndea CLI — nd-embedding-atlas viewer.
 *
 * Usage:
 *   ndea <path...>              Open zarr stores in viewer
 *   ndea config.yaml            Load multi-dataset project config
 *   ndea <path> --port 8080     Custom port
 *   ndea <path> --no-open       Don't auto-open browser
 *   ndea <path> --no-static     Don't serve frontend (dev mode)
 *   ndea --help                 Show this help message
 */

import { isYamlConfig, loadProjectConfig, pathsToConfig } from "./config.ts";
import type { ResolvedConfig } from "./config.ts";
import { validateZarrPath } from "./resolve.ts";
import { startup } from "./startup.ts";

// ─── Version ────────────────────────────────────────────────────────────────

const VERSION = "0.1.0";

// ─── Help text ──────────────────────────────────────────────────────────────

const HELP = `
  nd-embedding-atlas v${VERSION}

  Interactive browser-based dashboard linking AI embeddings
  to source 5D (TCZYX) image data.

  Usage:
    ndea <path...>              Open zarr stores in viewer
    ndea config.yaml            Load multi-dataset project config

  Options:
    --port <number>             Server port (default: 5055)
    --host <string>             Server host (default: localhost)
    --no-open                   Don't auto-open browser
    --no-static                 Don't serve frontend (dev mode)
    --obs-columns <cols>        Comma-separated obs columns to include
    --help, -h                  Show this help message
    --version, -v               Show version

  Examples:
    ndea ./experiment.zarr
    ndea ./exp1.zarr ./exp2.zarr
    ndea project.yaml
    ndea ./data.zarr --port 8080 --no-open
`;

// ─── Arg parsing ────────────────────────────────────────────────────────────

interface ParsedArgs {
    paths: string[];
    port?: number;
    host?: string;
    noOpen: boolean;
    noStatic: boolean;
    obsColumns?: string[];
    help: boolean;
    version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    const result: ParsedArgs = {
        paths: [],
        noOpen: false,
        noStatic: false,
        help: false,
        version: false,
    };

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];

        if (arg === "--help" || arg === "-h") {
            result.help = true;
            i++;
        } else if (arg === "--version" || arg === "-v") {
            result.version = true;
            i++;
        } else if (arg === "--no-open") {
            result.noOpen = true;
            i++;
        } else if (arg === "--no-static") {
            result.noStatic = true;
            i++;
        } else if (arg === "--port") {
            i++;
            if (i >= argv.length) {
                console.error("Error: --port requires a value");
                process.exit(1);
            }
            const port = Number(argv[i]);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                console.error(`Error: invalid port number: ${argv[i]}`);
                process.exit(1);
            }
            result.port = port;
            i++;
        } else if (arg === "--host") {
            i++;
            if (i >= argv.length) {
                console.error("Error: --host requires a value");
                process.exit(1);
            }
            result.host = argv[i];
            i++;
        } else if (arg === "--obs-columns") {
            i++;
            if (i >= argv.length) {
                console.error("Error: --obs-columns requires a value");
                process.exit(1);
            }
            result.obsColumns = argv[i]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            i++;
        } else if (arg.startsWith("--")) {
            console.error(`Error: unknown option: ${arg}`);
            console.error("Run 'ndea --help' for usage.");
            process.exit(1);
        } else {
            // Positional argument — a path
            result.paths.push(arg);
            i++;
        }
    }

    return result;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    // Parse args from Bun.argv (first 2 are bun executable + script path)
    const args = parseArgs(Bun.argv.slice(2));

    if (args.help) {
        console.log(HELP);
        process.exit(0);
    }

    if (args.version) {
        console.log(`ndea ${VERSION}`);
        process.exit(0);
    }

    if (args.paths.length === 0) {
        console.error("Error: at least one path is required.\n");
        console.log(HELP);
        process.exit(1);
    }

    // ── Load config ─────────────────────────────────────────────────────────

    let config: ResolvedConfig;

    if (args.paths.length === 1 && isYamlConfig(args.paths[0])) {
        // YAML project config
        try {
            const project = await loadProjectConfig(args.paths[0]);

            // Validate zarr paths
            for (const ds of project.datasets) {
                validateZarrPath(ds.path);
            }

            config = {
                datasets: project.datasets,
                obsColumns: args.obsColumns ?? project.obsColumns,
                port: args.port ?? project.settings?.port ?? 5055,
                host: args.host ?? project.settings?.host ?? "localhost",
                noOpen: args.noOpen,
                noStatic: args.noStatic,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error loading config: ${msg}`);
            process.exit(1);
        }
    } else {
        // Direct zarr paths
        try {
            for (const p of args.paths) {
                validateZarrPath(p);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${msg}`);
            process.exit(1);
        }

        const project = pathsToConfig(args.paths);
        config = {
            datasets: project.datasets,
            obsColumns: args.obsColumns,
            port: args.port ?? 5055,
            host: args.host ?? "localhost",
            noOpen: args.noOpen,
            noStatic: args.noStatic,
        };
    }

    // ── Run startup ─────────────────────────────────────────────────────────

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
}

main();
