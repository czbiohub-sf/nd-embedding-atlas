/**
 * End-to-end smoke tests for the bunli-backed subcommand router.
 *
 * We spawn `bun run src/cli/index.ts …` subprocesses so the test exercises
 * the real argv → command dispatch pipeline — no mocks. Each subprocess is
 * quick (no DuckDB / zarr boot) because the commands we hit short-circuit
 * before opening any store.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

// ANSI escape pattern built from a `String.fromCharCode` call to sidestep the
// `no-control-regex` lint while still matching the ESC (0x1B) character that
// bunli embeds for colour output.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<Result> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env, NDEA_DISABLE_AUTOUPDATER: "1" },
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: code ?? 0, stdout, stderr };
}

describe("router / help + version", () => {
  test("`ndea --help` lists subcommands", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    // Citty prints to stdout (with dim ANSI) — strip colors before matching.
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("view");
    expect(combined).toContain("install");
    expect(combined).toContain("update");
    expect(combined).toContain("rollback");
    expect(combined).toContain("plugin");
  });

  test("`ndea --version` prints the version number", async () => {
    const r = await run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/\d+\.\d+\.\d+/);
  });

  test("`ndea update --help` renders without booting zarr", async () => {
    const r = await run(["update", "--help"]);
    expect(r.code).toBe(0);
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("--force");
    expect(combined).toContain("--channel");
  });

  test("`ndea view --help` renders with viewer flags", async () => {
    const r = await run(["view", "--help"]);
    expect(r.code).toBe(0);
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("--port");
    expect(combined).toContain("--no-open");
    expect(combined).toContain("--host");
  });

  test("`ndea rollback --help` renders", async () => {
    const r = await run(["rollback", "--help"]);
    expect(r.code).toBe(0);
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("previous");
  });

  test("`ndea plugin --help` lists nested actions without falling through to view", async () => {
    const r = await run(["plugin", "--help"]);
    expect(r.code).toBe(0);
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("validate");
    expect(combined).toContain("list");
    expect(combined).toContain("enable");
    expect(combined).toContain("disable");
    expect(combined).not.toContain("at least one path is required");
  });
});

describe("router / default routing", () => {
  test("`ndea` with no args shows usage and exits 0", async () => {
    // bunli defaults to printing help on bare invocation — same convention
    // as git/gh/uv. Previous citty behaviour was to exit 1 because it
    // routed to `view` which then errored on missing positional. The
    // bunli default is friendlier; just verify usage shows up.
    const r = await run([]);
    expect(r.code).toBe(0);
    const combined = (r.stdout + r.stderr).replace(ANSI_PATTERN, "");
    expect(combined).toContain("view");
    expect(combined).toContain("install");
  });

  test("`ndea ./nonexistent.zarr` falls through to view and surfaces a path error", async () => {
    const r = await run(["/definitely/does/not/exist/data.zarr"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  test("`ndea view ./nonexistent.zarr` yields the same error as the default route", async () => {
    const r = await run(["view", "/definitely/does/not/exist/data.zarr"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  test("default YAML routing reports alias conflicts and exits 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ndea-router-config-"));
    const path = join(dir, "project.yaml");
    try {
      await Bun.write(
        path,
        `datasets:
  cells:
    anndata: data/a.zarr
    path: data/b.zarr
`,
      );
      const r = await run([path]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("Error loading config:");
      expect(r.stderr).toContain("'anndata'");
      expect(r.stderr).toContain("'path'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("`ndea rollback` without a compiled binary errors cleanly", async () => {
    const r = await run(["rollback"]);
    // Should not hit the view handler, should not crash, should fail fast.
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/compiled binary/);
  });

  test("`ndea update` without a compiled binary errors cleanly", async () => {
    const r = await run(["update"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/compiled binary/);
  });
});
