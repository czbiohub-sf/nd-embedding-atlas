import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_ROOT = join(import.meta.dir, "..", "..", "..");
const sandboxes: string[] = [];

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function sandbox(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "ndea-plugin-cli-"));
  sandboxes.push(home);
  return home;
}

function statePath(home: string, ...parts: string[]): string {
  return join(home, ".ndea", ...parts);
}

async function createPackage(home: string, path: string): Promise<void> {
  await mkdir(statePath(home, "plugins", "packages", ...path.split("/")), { recursive: true });
}

async function createPluginFixture(
  directory: string,
  options: { readonly sentinel?: string; readonly manifest?: Record<string, unknown>; readonly client?: string } = {},
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const manifest = {
    manifestSchemaVersion: 1,
    pluginId: "test.plugin",
    pluginPackageVersion: "1.0.0",
    sdkVersionRange: "*",
    displayName: "Test plugin",
    clientEntry: "client.js",
    staticAssets: ["style.css"],
    hostCompatibility: { hostVersionRange: "*" },
    license: "MIT",
    permissions: [],
    ...options.manifest,
  };
  const client =
    options.client ??
    `${options.sentinel ? `await Bun.write(${JSON.stringify(options.sentinel)}, "executed");\n` : ""}export default () => {};\n`;
  await Promise.all([
    writeFile(join(directory, "ndea-plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(directory, "client.js"), client),
    writeFile(join(directory, "style.css"), "body { color: currentColor; }\n"),
  ]);
}

async function run(home: string, args: string[]): Promise<Result> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], {
    cwd: APP_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NDEA_HOME: home, NDEA_DISABLE_AUTOUPDATER: "1" },
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe.skip("ndea plugin validate", () => {
  test("validates an explicit root without executing its self-contained client", async () => {
    const home = await sandbox();
    const root = join(home, "external-plugin");
    const sentinel = join(home, "plugin-executed");
    await createPluginFixture(root, { sentinel });

    const result = await run(home, ["plugin", "validate", root]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      "Plugin test.plugin@1.0.0 is valid.\n" +
        "Manifest: valid\n" +
        "Compatibility: compatible\n" +
        "Client entry: client.js\n" +
        "Static assets: style.css\n",
    );
    expect(result.stderr).toBe("");
    expect(await Bun.file(sentinel).exists()).toBe(false);
  });

  test("emits stable machine JSON for a valid manifest, compatibility, and assets", async () => {
    const home = await sandbox();
    const root = join(home, "external-plugin");
    await createPluginFixture(root);

    const result = await run(home, ["plugin", "validate", root, "--format", "json"]);
    const json = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(json).toMatchObject({
      ok: true,
      data: {
        valid: true,
        sourceId: "cli:validate",
        root,
        manifest: {
          pluginId: "test.plugin",
          pluginPackageVersion: "1.0.0",
          clientEntry: "client.js",
          staticAssets: ["style.css"],
        },
        compatibility: { status: "compatible" },
        clientEntry: "client.js",
        staticAssets: ["style.css"],
        diagnostics: [],
      },
    });
  });

  test("reports malformed manifests with a nonzero exit", async () => {
    const home = await sandbox();
    const root = join(home, "invalid-plugin");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "ndea-plugin.json"), '{"manifestSchemaVersion":1}\n');

    const result = await run(home, ["plugin", "validate", root, "--format", "json"]);
    const json = JSON.parse(result.stdout);

    expect(result.code).toBe(1);
    expect(json).toMatchObject({
      ok: false,
      data: {
        valid: false,
        manifest: null,
        compatibility: { status: "not-checked" },
        diagnostics: [{ severity: "error", stage: "manifest", code: "manifest-schema-invalid" }],
      },
    });
  });

  test("reports compatibility and asset failures without executing code", async () => {
    const home = await sandbox();
    const incompatibleRoot = join(home, "incompatible-plugin");
    await createPluginFixture(incompatibleRoot, {
      manifest: { hostCompatibility: { hostVersionRange: ">=999.0.0" } },
    });
    const incompatible = await run(home, ["plugin", "validate", incompatibleRoot, "--format", "json"]);
    expect(incompatible.code).toBe(1);
    expect(JSON.parse(incompatible.stdout)).toMatchObject({
      ok: false,
      data: {
        compatibility: { status: "incompatible" },
        diagnostics: [{ stage: "compatibility", code: "app-version-incompatible" }],
      },
    });

    const missingAssetRoot = join(home, "missing-asset-plugin");
    await createPluginFixture(missingAssetRoot, { manifest: { staticAssets: ["missing.css"] } });
    const missingAsset = await run(home, ["plugin", "validate", missingAssetRoot]);
    expect(missingAsset.code).toBe(1);
    expect(missingAsset.stdout).toContain("ERROR asset/asset-missing:");
  });

  test("rejects client runtime imports", async () => {
    const home = await sandbox();
    const root = join(home, "importing-plugin");
    await createPluginFixture(root, { client: 'import "./other.js";\nexport default () => {};\n' });
    await writeFile(join(root, "other.js"), "throw new Error('must not execute');\n");

    const result = await run(home, ["plugin", "validate", root, "--format", "json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      data: { diagnostics: [{ stage: "client-entry", code: "client-runtime-import" }] },
    });
  });
});

describe.skip("ndea plugin user configuration", () => {
  test("list reports an empty sandbox without creating state", async () => {
    const home = await sandbox();
    const result = await run(home, ["plugin", "list"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No user plugins configured.\n");
    expect(result.stderr).toBe("");
    expect(await Bun.file(statePath(home, "plugins", "config.json")).exists()).toBe(false);
  });

  test("enable appends the first package and writes stable schema-v1 bytes", async () => {
    const home = await sandbox();
    await createPackage(home, "acme/widgets");

    const result = await run(home, ["plugin", "enable", "acme/widgets"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Enabled plugin "acme/widgets". Changes take effect next session.\n');
    expect(result.stderr).toBe("");
    expect(await readFile(statePath(home, "plugins", "config.json"), "utf8")).toBe(
      '{\n  "schemaVersion": 1,\n  "entries": [\n    {\n      "path": "acme/widgets",\n      "enabled": true\n    }\n  ]\n}\n',
    );
  });

  test("re-enabling is an idempotent no-op", async () => {
    const home = await sandbox();
    await createPackage(home, "acme/widgets");
    await run(home, ["plugin", "enable", "acme/widgets"]);
    const before = await readFile(statePath(home, "plugins", "config.json"), "utf8");

    const result = await run(home, ["plugin", "enable", "./acme/widgets"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Plugin "acme/widgets" is already enabled.\n');
    expect(await readFile(statePath(home, "plugins", "config.json"), "utf8")).toBe(before);
  });

  test("disable preserves entry order and other entries", async () => {
    const home = await sandbox();
    await createPackage(home, "first");
    await createPackage(home, "second");
    await run(home, ["plugin", "enable", "first"]);
    await run(home, ["plugin", "enable", "second"]);

    const result = await run(home, ["plugin", "disable", "first"]);
    const list = await run(home, ["plugin", "list"]);
    const beforeRepeat = await readFile(statePath(home, "plugins", "config.json"), "utf8");
    const repeated = await run(home, ["plugin", "disable", "first"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Disabled plugin "first". Changes take effect next session.\n');
    expect(repeated.stdout).toBe('Plugin "first" is already disabled.\n');
    expect(await readFile(statePath(home, "plugins", "config.json"), "utf8")).toBe(beforeRepeat);
    expect(list.stdout).toBe("User plugins (discovery order):\n  [disabled] first\n  [enabled] second\n");
    expect(JSON.parse(await readFile(statePath(home, "plugins", "config.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      entries: [
        { path: "first", enabled: false },
        { path: "second", enabled: true },
      ],
    });
  });

  test("disable is idempotent and does not add an unknown package", async () => {
    const home = await sandbox();
    const result = await run(home, ["plugin", "disable", "not-configured"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Plugin "not-configured" is not configured; no changes made.\n');
    expect(await Bun.file(statePath(home, "plugins", "config.json")).exists()).toBe(false);
  });

  test("machine JSON preserves ordered paths and enabled state", async () => {
    const home = await sandbox();
    await createPackage(home, "first");
    await createPackage(home, "second");
    await run(home, ["plugin", "enable", "first"]);
    await run(home, ["plugin", "enable", "second"]);

    const result = await run(home, ["plugin", "list", "--format", "json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: {
        schemaVersion: 1,
        entries: [
          { path: "first", enabled: true },
          { path: "second", enabled: true },
        ],
      },
    });
  });

  test("enable and disable expose idempotent machine state transitions", async () => {
    const home = await sandbox();
    await createPackage(home, "machine-plugin");

    const enabled = await run(home, ["plugin", "enable", "machine-plugin", "--format", "json"]);
    const disabled = await run(home, ["plugin", "disable", "machine-plugin", "--format", "json"]);

    expect(enabled.code).toBe(0);
    expect(JSON.parse(enabled.stdout)).toEqual({
      ok: true,
      data: {
        path: "machine-plugin",
        enabled: true,
        changed: true,
        configured: true,
        takesEffect: "next-session",
      },
    });
    expect(disabled.code).toBe(0);
    expect(JSON.parse(disabled.stdout)).toEqual({
      ok: true,
      data: {
        path: "machine-plugin",
        enabled: false,
        changed: true,
        configured: true,
        takesEffect: "next-session",
      },
    });
  });

  test("absolute and escaping roots fail without creating config", async () => {
    const home = await sandbox();
    for (const path of ["/tmp/outside", "../outside"]) {
      const result = await run(home, ["plugin", "enable", path, "--format", "json"]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "PLUGIN_CONFIG_UPDATE_FAILED" } });
    }
    expect(await Bun.file(statePath(home, "plugins", "config.json")).exists()).toBe(false);
  });

  test("enable rejects a package symlink that resolves outside packages", async () => {
    const home = await sandbox();
    const packages = statePath(home, "plugins", "packages");
    const outside = join(home, "outside");
    await mkdir(packages, { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(packages, "escape"));

    const result = await run(home, ["plugin", "enable", "escape", "--format", "json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "PLUGIN_CONFIG_UPDATE_FAILED" } });
    expect(await Bun.file(statePath(home, "plugins", "config.json")).exists()).toBe(false);
  });

  test("malformed and future configs fail without being overwritten", async () => {
    for (const bytes of ['{"schemaVersion":1,"entries":', '{"schemaVersion":2,"entries":[]}\n']) {
      const home = await sandbox();
      const configPath = statePath(home, "plugins", "config.json");
      await mkdir(statePath(home, "plugins"), { recursive: true });
      await createPackage(home, "anything");
      await writeFile(configPath, bytes);

      const listed = await run(home, ["plugin", "list", "--format", "json"]);
      const enabled = await run(home, ["plugin", "enable", "anything", "--format", "json"]);

      expect(listed.code).toBe(1);
      expect(JSON.parse(listed.stdout)).toMatchObject({ ok: false, error: { code: "PLUGIN_CONFIG_READ_FAILED" } });
      expect(enabled.code).toBe(1);
      expect(JSON.parse(enabled.stdout)).toMatchObject({ ok: false, error: { code: "PLUGIN_CONFIG_UPDATE_FAILED" } });
      expect(await readFile(configPath, "utf8")).toBe(bytes);
    }
  });

  test("a failed atomic replacement leaves the prior config bytes intact", async () => {
    const home = await sandbox();
    await createPackage(home, "first");
    await run(home, ["plugin", "enable", "first"]);
    const directory = statePath(home, "plugins");
    const configPath = join(directory, "config.json");
    const before = await readFile(configPath, "utf8");
    await chmod(directory, 0o500);

    try {
      const result = await run(home, ["plugin", "disable", "first", "--format", "json"]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: "PLUGIN_CONFIG_UPDATE_FAILED" } });
      expect(await readFile(configPath, "utf8")).toBe(before);
    } finally {
      await chmod(directory, 0o700);
    }
  });
});
