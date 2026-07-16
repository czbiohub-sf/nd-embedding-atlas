import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { servePluginAsset } from "./assets";
import { buildPluginBootstrap } from "./bootstrap";

const REPO_ROOT = resolve(import.meta.dir, "../../../../../");
const EXAMPLE_BUILD = resolve(REPO_ROOT, "examples/plugins/custom-node/build.ts");
const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function buildExample(root: string): Promise<void> {
  const process = Bun.spawn(["bun", "run", EXAMPLE_BUILD, "--outdir", root], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Example build failed:\n${stdout}${stderr}`);
}

test("serves the built author example from one immutable plugin snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "ndea-hosted-example-plugin-"));
  sandboxes.push(root);
  await buildExample(root);

  const snapshot = await buildPluginBootstrap({
    projectPluginPaths: [root],
    projectPluginContainmentRoot: root,
    userConfig: { schemaVersion: 1, entries: [] },
  });
  const entry = snapshot.catalog.entries[0];
  expect(entry?.manifest.pluginId as string).toBe("org.ndea.example");
  expect(snapshot.catalog.diagnostics).toEqual([]);

  const clientResponse = entry ? servePluginAsset(entry.clientEntryUrl, snapshot) : null;
  expect(clientResponse?.status).toBe(200);
  expect(clientResponse?.headers.get("Content-Type")).toBe("application/javascript; charset=utf-8");
  const client = await clientResponse?.text();
  expect(new Bun.Transpiler({ loader: "js" }).scan(client ?? "").imports).toEqual([]);

  const stylesheetUrl = entry?.staticAssetUrls["assets/styles.css"];
  const stylesheetResponse = stylesheetUrl ? servePluginAsset(stylesheetUrl, snapshot) : null;
  expect(stylesheetResponse?.status).toBe(200);
  expect(stylesheetResponse?.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
  expect(await stylesheetResponse?.text()).toContain(".ndea-example-card");
  expect(servePluginAsset(`${entry?.clientEntryUrl}/undeclared`, snapshot)).toBeNull();
});
