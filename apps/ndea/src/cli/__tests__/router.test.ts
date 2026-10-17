/**
 * Router tests. In-process `captureExecute` covers parsing, help, version,
 * completion, validation, and rendered errors; subprocesses cover actions
 * that need a real process (view startup paths).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { app } from "../index.ts";
import { server } from "../lib/server.ts";
import { VERSION } from "../version.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b[[\]]/;

async function spawn(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
}

/** A port with nothing listening: bind an ephemeral one, then release it. */
function closedPort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  void probe.stop(true);
  return port;
}

const savedEnv = { ...process.env };
afterEach(() => {
  for (const key of ["NDEA_HOST", "NDEA_PORT", "FORCE_COLOR", "NO_COLOR"]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("router / help, version, completion", () => {
  test("`ndea --version` prints the bare version", async () => {
    const r = await captureExecute(app, ["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  test("`ndea --help` and bare `ndea` list the command tree", async () => {
    for (const argv of [["--help"], []]) {
      const r = await captureExecute(app, argv);
      expect(r.exitCode).toBe(0);
      for (const name of ["view", "workspace", "mcp", "self", "man", "completion"]) expect(r.stdout).toContain(name);
      for (const gone of ["filter", "update", "gc", "doctor"])
        expect(r.stdout).not.toMatch(new RegExp(`^  ${gone}\\b`, "m"));
    }
  });

  test("`ndea self update --help` renders its flags", async () => {
    const update = await captureExecute(app, ["self", "update", "--help"]);
    expect(update.exitCode).toBe(0);
    expect(update.stdout).toContain("--channel");
    expect(update.stdout).toContain("--no-gc");
    const view = await captureExecute(app, ["view", "--help"]);
    expect(view.stdout).toContain("--no-open");
    expect(view.stdout).toContain("--port");
  });

  test("`ndea completion zsh` covers every command", async () => {
    const r = await captureExecute(app, ["completion", "zsh"]);
    expect(r.exitCode).toBe(0);
    for (const name of ["view", "workspace", "query", "mcp", "install", "self", "doctor", "prune"]) {
      expect(r.stdout).toContain(name);
    }
  });

  test("`ndea man` prints an mdoc page", async () => {
    const r = await captureExecute(app, ["man"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toStartWith(".Dd ");
    expect(r.stdout).toContain(".Nm ndea");
  });
});

describe("router / groups and validation", () => {
  test("`ndea workspace` routes to its subcommands", async () => {
    const help = await captureExecute(app, ["workspace", "--help"]);
    for (const name of ["get", "patch", "result", "query"]) expect(help.stdout).toContain(name);
    const typo = await captureExecute(app, ["workspace", "gte"]);
    expect(typo.exitCode).toBe(1);
    expect(typo.stderr).toContain('Did you mean "get"?');
  });

  test("`ndea workspace query` rejects a bad --limit and bad --where before any request", async () => {
    const limit = await captureExecute(app, ["workspace", "query", "--limit=-3"]);
    expect(limit.exitCode).toBe(1);
    expect(limit.stderr).toContain("flags.limit");
    const where = await captureExecute(app, ["workspace", "query", "--where", "{bad"]);
    expect(where.exitCode).toBe(1);
    expect(where.stderr).toContain("--where");
  });

  test("a bad --port fails validation before view runs", async () => {
    const r = await captureExecute(app, ["--port", "99999", "x.zarr"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("flags.port");
  });
});

describe("router / server context", () => {
  const origin = new Crust("probe")
    .provide(server())
    .action(async ({ ctx, stdout }) => stdout((await ctx.server).origin));

  test("--port beats NDEA_PORT beats the 127.0.0.1:5055 default", async () => {
    expect((await captureExecute(origin, [])).stdout.trim()).toBe("http://127.0.0.1:5055");
    process.env.NDEA_PORT = "6002";
    process.env.NDEA_HOST = "localhost";
    expect((await captureExecute(origin, [])).stdout.trim()).toBe("http://localhost:6002");
    expect((await captureExecute(origin, ["--port", "6001", "--host", "127.0.0.2"])).stdout.trim()).toBe(
      "http://127.0.0.2:6001",
    );
  });

  test("no server answering: one rendered error, exit 1, empty stdout", async () => {
    const port = closedPort();
    const r = await captureExecute(app, ["workspace", "get", "--port", String(port)]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(`✗ no ndea server at http://127.0.0.1:${port}`);
    expect(r.stderr).toContain("ndea view");
  });
});

describe("router / color", () => {
  test("--no-color strips every escape, even under FORCE_COLOR", async () => {
    process.env.FORCE_COLOR = "3";
    const colored = await captureExecute(app, ["self", "doctor"]);
    expect(colored.stdout).toMatch(ANSI);
    const plain = await captureExecute(app, ["self", "doctor", "--no-color"]);
    expect(plain.stdout).toContain("self doctor");
    expect(plain.stdout).not.toMatch(ANSI);
    expect(plain.stderr).not.toMatch(ANSI);
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
      expect(r.stderr).toContain("could not load config:");
      expect(r.stderr).toContain("'anndata'");
      expect(r.stderr).toContain("'path'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`ndea self update` without a compiled binary errors cleanly", async () => {
    const r = await captureExecute(app, ["self", "update"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/compiled binary/);
  });
});
