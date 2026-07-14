import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildCustomNodePlugin } from "./build";

const APP_ROOT = resolve(import.meta.dir, "../../../apps/ndea");
const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("builds one self-contained client and validates it through the public CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "ndea-example-plugin-"));
  sandboxes.push(root);
  await buildCustomNodePlugin(root);

  const client = await Bun.file(join(root, "dist/client.js")).text();
  const imports = new Bun.Transpiler({ loader: "js" }).scan(client).imports;
  expect(imports).toEqual([]);

  const process = Bun.spawn(["bun", "run", "src/cli/index.ts", "plugin", "validate", root, "--format", "json"], {
    cwd: APP_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      NDEA_HOME: join(root, ".home"),
      NDEA_DISABLE_AUTOUPDATER: "1",
    },
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toMatchObject({
    ok: true,
    data: {
      valid: true,
      manifest: {
        pluginId: "org.ndea.example",
        pluginPackageVersion: "1.0.0",
        clientEntry: "dist/client.js",
        staticAssets: ["assets/styles.css"],
        permissions: [],
      },
      compatibility: { status: "compatible" },
      clientEntry: "dist/client.js",
      staticAssets: ["assets/styles.css"],
      diagnostics: [],
    },
  });
});
