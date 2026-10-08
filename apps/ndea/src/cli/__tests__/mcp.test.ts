import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_ROOT = join(import.meta.dir, "..", "..", "..");
let home = "";
afterEach(() => rm(home, { recursive: true, force: true }));

/** Run the CLI against a sandbox HOME (add-mcp and ~/.ndea both resolve from it); a closed port keeps the server check offline. */
async function ndea(...args: string[]): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", "mcp", ...args, "--port", "1"], {
    cwd: APP_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: home },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out + err };
}

describe("ndea mcp", () => {
  test("install writes the endpoint and token; check flags a rotated token; uninstall removes it", async () => {
    home = await mkdtemp(join(tmpdir(), "ndea-mcp-cli-"));
    await mkdir(join(home, ".codex"));

    const install = await ndea("install", "--agent", "codex");
    expect(install.code).toBe(0);
    const token = (await readFile(join(home, ".ndea", "mcp-token"), "utf8")).trim();
    const config = await readFile(join(home, ".codex", "config.toml"), "utf8");
    expect(config).toContain("http://127.0.0.1:1/mcp");
    expect(config).toContain(`Bearer ${token}`);

    const current = await ndea("check");
    expect(current.out).toMatch(/✓ Codex .*config\.toml/);

    await writeFile(join(home, ".ndea", "mcp-token"), "rotated\n");
    const stale = await ndea("check");
    expect(stale.code).toBe(1);
    expect(stale.out).toMatch(/✗ Codex\s+has an old token/);

    expect((await ndea("uninstall", "--agent", "codex")).code).toBe(0);
    expect(await readFile(join(home, ".codex", "config.toml"), "utf8")).not.toContain("127.0.0.1");
  });

  test("refuses to guess targets without a terminal", async () => {
    home = await mkdtemp(join(tmpdir(), "ndea-mcp-cli-"));
    const result = await ndea("install");
    expect(result.code).toBe(1);
    expect(result.out).toContain("--agent");
  });
});
