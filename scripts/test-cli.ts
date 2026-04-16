/**
 * CLI test script — exercises arg parsing, YAML config loading, and path resolution.
 *
 * Run: bun run scripts/test-cli.ts
 */

import { afterAll, describe, test, expect } from "bun:test";
import { isYamlConfig, loadProjectConfig, pathsToConfig } from "../src/cli/config.ts";
import { resolveFrontendDir, getNetworkAddress } from "../src/cli/resolve.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

// ─── Config detection ───────────────────────────────────────────────────────

describe("isYamlConfig", () => {
    test("detects .yaml files", () => {
        expect(isYamlConfig("project.yaml")).toBe(true);
        expect(isYamlConfig("/path/to/config.yaml")).toBe(true);
    });

    test("detects .yml files", () => {
        expect(isYamlConfig("project.yml")).toBe(true);
    });

    test("rejects non-yaml files", () => {
        expect(isYamlConfig("data.zarr")).toBe(false);
        expect(isYamlConfig("/path/to/store.zarr")).toBe(false);
        expect(isYamlConfig("file.json")).toBe(false);
    });
});

// ─── YAML config parsing ────────────────────────────────────────────────────

describe("loadProjectConfig", () => {
    const tmpBase = join(tmpdir(), `ndea-test-cli-${Date.now()}`);

    // Setup: create temp dir with a test YAML and mock zarr stores
    const zarrDir1 = join(tmpBase, "exp1.zarr");
    const zarrDir2 = join(tmpBase, "exp2.zarr");

    mkdirSync(zarrDir1, { recursive: true });
    mkdirSync(zarrDir2, { recursive: true });
    writeFileSync(join(zarrDir1, ".zgroup"), "{}");
    writeFileSync(join(zarrDir2, ".zgroup"), "{}");

    test("loads a valid multi-dataset config", async () => {
        const yamlContent = `
datasets:
  - name: experiment_1
    path: exp1.zarr
  - name: experiment_2
    path: exp2.zarr

obs_columns:
  - cell_type
  - disease

settings:
  port: 8080
  host: 0.0.0.0
`;
        const yamlPath = join(tmpBase, "test-config.yaml");
        writeFileSync(yamlPath, yamlContent);

        const config = await loadProjectConfig(yamlPath);

        expect(config.datasets).toHaveLength(2);
        expect(config.datasets[0].name).toBe("experiment_1");
        expect(config.datasets[0].path).toBe(zarrDir1);
        expect(config.datasets[1].name).toBe("experiment_2");
        expect(config.datasets[1].path).toBe(zarrDir2);
        expect(config.obsColumns).toEqual(["cell_type", "disease"]);
        expect(config.settings?.port).toBe(8080);
        expect(config.settings?.host).toBe("0.0.0.0");
    });

    test("loads config with channels", async () => {
        const yamlContent = `
datasets:
  - name: exp1
    path: exp1.zarr
    plate_path: exp1.zarr
    channels:
      DAPI:
        color: "0000FF"
      GFP:
        color: "00FF00"
        contrast: [0, 255]
        visible: false
`;
        const yamlPath = join(tmpBase, "test-channels.yaml");
        writeFileSync(yamlPath, yamlContent);

        const config = await loadProjectConfig(yamlPath);

        expect(config.datasets[0].channels).toBeDefined();
        expect(config.datasets[0].channels!.DAPI.color).toBe("0000FF");
        expect(config.datasets[0].channels!.GFP.color).toBe("00FF00");
        expect(config.datasets[0].channels!.GFP.contrast).toEqual([0, 255]);
        expect(config.datasets[0].channels!.GFP.visible).toBe(false);
        expect(config.datasets[0].platePath).toBe(zarrDir1);
    });

    test("loads minimal config (no optional fields)", async () => {
        const yamlContent = `
datasets:
  - name: simple
    path: exp1.zarr
`;
        const yamlPath = join(tmpBase, "test-minimal.yaml");
        writeFileSync(yamlPath, yamlContent);

        const config = await loadProjectConfig(yamlPath);

        expect(config.datasets).toHaveLength(1);
        expect(config.obsColumns).toBeUndefined();
        expect(config.settings).toBeUndefined();
    });

    test("rejects missing file", async () => {
        await expect(loadProjectConfig("/nonexistent/config.yaml")).rejects.toThrow(
            "Config file not found",
        );
    });

    test("rejects config without datasets", async () => {
        const yamlPath = join(tmpBase, "test-no-datasets.yaml");
        writeFileSync(yamlPath, "settings:\n  port: 8080\n");

        await expect(loadProjectConfig(yamlPath)).rejects.toThrow("datasets");
    });

    test("rejects dataset entry missing name", async () => {
        const yamlPath = join(tmpBase, "test-no-name.yaml");
        writeFileSync(yamlPath, "datasets:\n  - path: exp1.zarr\n");

        await expect(loadProjectConfig(yamlPath)).rejects.toThrow("name");
    });

    test("rejects dataset entry missing path", async () => {
        const yamlPath = join(tmpBase, "test-no-path.yaml");
        writeFileSync(yamlPath, "datasets:\n  - name: foo\n");

        await expect(loadProjectConfig(yamlPath)).rejects.toThrow("path");
    });

    // Cleanup
    afterAll(() => {
        try {
            rmSync(tmpBase, { recursive: true, force: true });
        } catch {
            // best-effort
        }
    });
});

// ─── Path-based config ──────────────────────────────────────────────────────

describe("pathsToConfig", () => {
    test("converts paths to dataset entries", () => {
        const config = pathsToConfig(["/data/exp1.zarr", "/data/exp2.zarr"]);

        expect(config.datasets).toHaveLength(2);
        expect(config.datasets[0].name).toBe("exp1");
        expect(config.datasets[0].path).toBe("/data/exp1.zarr");
        expect(config.datasets[1].name).toBe("exp2");
        expect(config.datasets[1].path).toBe("/data/exp2.zarr");
    });

    test("strips .zarr extension from name", () => {
        const config = pathsToConfig(["/data/my_experiment.zarr"]);
        expect(config.datasets[0].name).toBe("my_experiment");
    });

    test("handles paths without .zarr extension", () => {
        const config = pathsToConfig(["/data/mystore"]);
        expect(config.datasets[0].name).toBe("mystore");
    });
});

// ─── Frontend resolution ────────────────────────────────────────────────────

describe("resolveFrontendDir", () => {
    test("returns string or undefined (no crash)", () => {
        const result = resolveFrontendDir();
        expect(result === undefined || typeof result === "string").toBe(true);
    });
});

// ─── Network address ────────────────────────────────────────────────────────

describe("getNetworkAddress", () => {
    test("returns string or undefined (no crash)", () => {
        const result = getNetworkAddress();
        expect(result === undefined || typeof result === "string").toBe(true);
    });
});

// ─── Arg parsing (via CLI execution) ────────────────────────────────────────

describe("CLI --help and --version", () => {
    test("--help prints usage and exits 0", async () => {
        const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "--help"], {
            cwd: join(import.meta.dir, ".."),
            stdout: "pipe",
            stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();

        expect(exitCode).toBe(0);
        expect(stdout).toContain("nd-embedding-atlas");
        expect(stdout).toContain("--port");
        expect(stdout).toContain("--no-open");
    });

    test("--version prints version and exits 0", async () => {
        const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "--version"], {
            cwd: join(import.meta.dir, ".."),
            stdout: "pipe",
            stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();

        expect(exitCode).toBe(0);
        expect(stdout).toContain("ndea 0.1.0");
    });

    test("no args prints error and exits 1", async () => {
        const proc = Bun.spawn(["bun", "run", "src/cli/index.ts"], {
            cwd: join(import.meta.dir, ".."),
            stdout: "pipe",
            stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stderr = await new Response(proc.stderr).text();

        expect(exitCode).toBe(1);
        expect(stderr).toContain("at least one path is required");
    });

    test("unknown option prints error and exits 1", async () => {
        const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "--bogus"], {
            cwd: join(import.meta.dir, ".."),
            stdout: "pipe",
            stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stderr = await new Response(proc.stderr).text();

        expect(exitCode).toBe(1);
        expect(stderr).toContain("unknown option");
    });

    test("nonexistent zarr path prints error and exits 1", async () => {
        const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "/nonexistent/data.zarr"], {
            cwd: join(import.meta.dir, ".."),
            stdout: "pipe",
            stderr: "pipe",
        });
        const exitCode = await proc.exited;
        const stderr = await new Response(proc.stderr).text();

        expect(exitCode).toBe(1);
        expect(stderr).toContain("does not exist");
    });
});
