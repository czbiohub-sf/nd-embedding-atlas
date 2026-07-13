import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginBootstrapCatalogSchema } from "@ndea/protocol";
import { buildPluginBootstrap } from "./bootstrap.ts";
import { digestPlugin, servePluginAsset } from "./assets.ts";
import { pluginPackagesPath } from "./config.ts";
import { validatePluginRoot } from "./discovery.ts";

const fixtureRoot = join(import.meta.dir, "__fixtures__");
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ndea-plugin-discovery-"));
  temporaryRoots.push(root);
  return root;
}

interface PluginFixtureOptions {
  client?: string;
  assets?: Record<string, string>;
  sdkVersionRange?: string;
  appVersionRange?: string;
  platforms?: string[];
}

async function createPlugin(root: string, pluginId: string, options: PluginFixtureOptions = {}): Promise<void> {
  const assets = options.assets ?? {};
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "ndea-plugin.json"),
    `${JSON.stringify(
      {
        manifestSchemaVersion: 1,
        pluginId,
        pluginPackageVersion: "1.0.0",
        sdkVersionRange: options.sdkVersionRange ?? "*",
        displayName: pluginId,
        clientEntry: "client.js",
        staticAssets: Object.keys(assets),
        hostCompatibility: {
          hostVersionRange: options.appVersionRange ?? "*",
          ...(options.platforms ? { platforms: options.platforms } : {}),
        },
        license: "MIT",
        permissions: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(root, "client.js"), options.client ?? "export default function register() {}\n");
  for (const [path, contents] of Object.entries(assets)) {
    const destination = join(root, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("validatePluginRoot", () => {
  test("validates the manifest before executable code and never evaluates trusted ESM server-side", async () => {
    expect("__ndeaPluginFixtureExecuted" in globalThis).toBe(false);
    const invalid = await validatePluginRoot(join(fixtureRoot, "invalid-manifest"), { sourceId: "project:0" });
    expect(invalid.plugin).toBeUndefined();
    expect(invalid.diagnostics[0]).toMatchObject({
      sourceId: "project:0",
      stage: "manifest",
      code: "manifest-schema-invalid",
    });

    const valid = await validatePluginRoot(join(fixtureRoot, "valid-plugin"), { sourceId: "project:1" });
    expect(String(valid.plugin?.manifest.pluginId)).toBe("fixture.valid");
    expect("__ndeaPluginFixtureExecuted" in globalThis).toBe(false);
  });

  test("rejects client runtime imports before publishing an entry", async () => {
    const result = await validatePluginRoot(join(fixtureRoot, "runtime-import"));
    expect(result.plugin).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ stage: "client-entry", code: "client-runtime-import" });

    const dynamicRoot = await temporaryRoot();
    await createPlugin(dynamicRoot, "fixture.dynamic-import", {
      client: 'export const load = () => import("./dependency.js");\n',
    });
    const dynamicResult = await validatePluginRoot(dynamicRoot);
    expect(dynamicResult.plugin).toBeUndefined();
    expect(dynamicResult.diagnostics[0]).toMatchObject({ stage: "client-entry", code: "client-runtime-import" });
  });

  test("rejects malformed client JavaScript", async () => {
    const root = await temporaryRoot();
    await createPlugin(root, "fixture.invalid-js", { client: "export const = ;\n" });
    const result = await validatePluginRoot(root);
    expect(result.plugin).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ stage: "client-entry", code: "client-syntax-invalid" });
  });

  test("checks SDK, app, and platform compatibility before client validation", async () => {
    const root = await temporaryRoot();
    await createPlugin(root, "fixture.compat", {
      client: 'import "./missing.js";\n',
      sdkVersionRange: ">=9.0.0",
      appVersionRange: ">=9.0.0",
      platforms: ["win32"],
    });
    const result = await validatePluginRoot(root, {
      sdkVersion: "1.0.0",
      appVersion: "1.0.0",
      platform: "linux",
    });
    expect(result.diagnostics[0]).toMatchObject({ stage: "compatibility", code: "sdk-version-incompatible" });
  });

  test("rejects an allowlisted asset whose symlink escapes the canonical root", async () => {
    const base = await temporaryRoot();
    const root = join(base, "plugin");
    const outside = join(base, "secret.css");
    await createPlugin(root, "fixture.escape", { assets: { "styles.css": "placeholder" } });
    await rm(join(root, "styles.css"));
    await writeFile(outside, "secret");
    await symlink(outside, join(root, "styles.css"));

    const result = await validatePluginRoot(root);
    expect(result.plugin).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ stage: "asset", code: "asset-path-escape" });
  });

  test("rejects a project root symlink that escapes its declared project directory", async () => {
    const base = await temporaryRoot();
    const project = join(base, "project");
    const outside = join(base, "outside-plugin");
    await Promise.all([mkdir(join(project, "plugins"), { recursive: true }), createPlugin(outside, "fixture.outside")]);
    const declaredRoot = join(project, "plugins", "escaped");
    await symlink(outside, declaredRoot);

    const snapshot = await buildPluginBootstrap({
      projectPluginPaths: [declaredRoot],
      projectPluginContainmentRoot: project,
      userConfig: { schemaVersion: 1, entries: [] },
    });
    expect(snapshot.catalog.entries).toHaveLength(0);
    expect(snapshot.catalog.diagnostics[0]).toMatchObject({
      sourceId: "project:0",
      stage: "discovery",
      code: "root-path-escape",
    });
  });
});

describe("plugin bootstrap snapshot", () => {
  test("keeps project then enabled-user declaration order and isolates neighboring failures", async () => {
    const base = await temporaryRoot();
    const projectValid = join(base, "project-valid");
    const projectInvalid = join(base, "project-invalid");
    const stateRoot = join(base, "state");
    const userRoot = join(pluginPackagesPath(stateRoot), "user-valid");
    await Promise.all([
      createPlugin(projectValid, "fixture.project"),
      createPlugin(userRoot, "fixture.user"),
      mkdir(projectInvalid, { recursive: true }),
    ]);
    await writeFile(join(projectInvalid, "ndea-plugin.json"), "not json");

    const snapshot = await buildPluginBootstrap({
      projectPluginPaths: [projectInvalid, projectValid],
      stateRoot,
      userConfig: {
        schemaVersion: 1,
        entries: [
          { path: "missing-disabled", enabled: false },
          { path: "user-valid", enabled: true },
        ],
      },
    });

    expect(snapshot.catalog.entries.map((entry) => String(entry.manifest.pluginId))).toEqual([
      "fixture.project",
      "fixture.user",
    ]);
    expect(snapshot.catalog.entries.map((entry) => entry.sourceId)).toEqual(["project:1", "user:1"]);
    expect(snapshot.catalog.diagnostics).toHaveLength(1);
    expect(snapshot.catalog.diagnostics[0]).toMatchObject({ sourceId: "project:0", code: "manifest-json-invalid" });
    expect(PluginBootstrapCatalogSchema.safeParse(snapshot.catalog).success).toBe(true);
    expect(JSON.stringify(snapshot.catalog)).not.toContain(base);
  });

  test("publishes only allowlisted files and digest changes with approved bytes", async () => {
    const base = await temporaryRoot();
    const root = join(base, "plugin");
    await createPlugin(root, "fixture.digest", {
      assets: { "assets/styles.css": ".before {}", "assets/data.json": "{}" },
    });
    await writeFile(join(root, "undeclared.txt"), "not approved");

    const first = await validatePluginRoot(root, { sourceId: "project:0" });
    expect(first.plugin).toBeDefined();
    const firstPlugin = first.plugin;
    if (!firstPlugin) throw new Error("fixture should validate");
    const firstDigest = digestPlugin(firstPlugin);
    const firstSnapshot = await buildPluginBootstrap({
      projectPluginPaths: [root],
      userConfig: { schemaVersion: 1, entries: [] },
    });
    const entry = firstSnapshot.catalog.entries[0];
    expect(Object.keys(entry?.staticAssetUrls ?? {})).toEqual(["assets/styles.css", "assets/data.json"]);
    expect(servePluginAsset(`/plugins/${firstDigest}/undeclared.txt`, firstSnapshot)).toBeNull();

    await writeFile(join(root, "assets/styles.css"), ".after {}");
    const second = await validatePluginRoot(root, { sourceId: "project:0" });
    if (!second.plugin) throw new Error("updated fixture should validate");
    expect(digestPlugin(second.plugin)).not.toBe(firstDigest);
  });

  test("serves startup-captured bytes without rescanning or reading plugin disk", async () => {
    const base = await temporaryRoot();
    const root = join(base, "plugin");
    await createPlugin(root, "fixture.snapshot", { client: "export const captured = 'startup';\n" });
    const snapshot = await buildPluginBootstrap({
      projectPluginPaths: [root],
      userConfig: { schemaVersion: 1, entries: [] },
    });
    const url = snapshot.catalog.entries[0]?.clientEntryUrl;
    if (!url) throw new Error("expected client entry URL");

    await rm(root, { recursive: true, force: true });
    const response = servePluginAsset(url, snapshot);
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("export const captured = 'startup';\n");
    expect(String(snapshot.catalog.entries[0]?.manifest.pluginId)).toBe("fixture.snapshot");
  });
});
