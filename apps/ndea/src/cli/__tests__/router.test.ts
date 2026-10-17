/**
 * Router tests. In-process `captureExecute` covers parsing, help, version,
 * completion, and validation; subprocesses cover actions that exit the
 * process (path errors, compiled-only commands).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureExecute } from "@crustjs/testing";
import { app } from "../index.ts";
import { VERSION } from "../version.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

async function spawn(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
}

describe("router / help, version, completion", () => {
  test("`ndea --version` prints the bare version", async () => {
    const r = await captureExecute(app, ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  test("`ndea --help` and bare `ndea` list subcommands", async () => {
    for (const argv of [["--help"], []]) {
      const r = await captureExecute(app, argv);
      expect(r.exitCode).toBe(0);
      for (const name of ["view", "update", "workspace", "mcp", "completion"]) expect(r.stdout).toContain(name);
    }
  });

  test("subcommand help renders flags", async () => {
    const update = await captureExecute(app, ["update", "--help"]);
    expect(update.stdout).toContain("--channel");
    expect(update.stdout).toContain("--no-gc");
    const view = await captureExecute(app, ["view", "--help"]);
    expect(view.stdout).toContain("--no-open");
    expect(view.stdout).toContain("--port");
  });

  test("`ndea completion zsh` covers every command", async () => {
    const r = await captureExecute(app, ["completion", "zsh"]);
    expect(r.exitCode).toBe(0);
    for (const name of ["view", "workspace", "patch", "mcp", "install", "doctor"]) expect(r.stdout).toContain(name);
  });
});

describe("router / groups and validation", () => {
  test("`ndea workspace` routes to its subcommands", async () => {
    const help = await captureExecute(app, ["workspace", "--help"]);
    for (const name of ["get", "patch", "result"]) expect(help.stdout).toContain(name);
    const typo = await captureExecute(app, ["workspace", "gte"]);
    expect(typo.exitCode).toBe(1);
    expect(typo.stderr).toContain('Did you mean "get"?');
  });

  test("a bad --port fails validation before view runs", async () => {
    const r = await captureExecute(app, ["--port", "99999", "x.zarr"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("flags.port");
  });
});

describe("router / default routing", () => {
  test("`ndea <path>` and `ndea view <path>` report the same path error", async () => {
    for (const args of [["/definitely/does/not/exist/data.zarr"], ["view", "/definitely/does/not/exist/data.zarr"]]) {
      const r = await spawn(args);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/does not exist/);
    }
  });

  test("default YAML routing reports alias conflicts and exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndea-router-config-"));
    const path = join(dir, "project.yaml");
    try {
      await Bun.write(path, "datasets:\n  cells:\n    anndata: data/a.zarr\n    path: data/b.zarr\n");
      const r = await spawn([path, "--port", "8080"]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("Error loading config:");
      expect(r.stderr).toContain("'anndata'");
      expect(r.stderr).toContain("'path'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`ndea update` without a compiled binary errors cleanly", async () => {
    const r = await spawn(["update"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/compiled binary/);
  });
});
