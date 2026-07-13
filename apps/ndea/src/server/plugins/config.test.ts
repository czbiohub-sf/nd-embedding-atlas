import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PLUGIN_CONFIG_SCHEMA_VERSION,
  normalizePluginConfigPath,
  parsePluginConfig,
  pluginConfigPath,
  pluginPackagesPath,
  readPluginConfig,
  resolveUserPluginPath,
  writePluginConfig,
} from "./config.ts";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ndea-plugin-config-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("plugin user config", () => {
  test("parses strict version-1 ordered entries and normalizes relative paths", () => {
    expect(
      parsePluginConfig({
        schemaVersion: PLUGIN_CONFIG_SCHEMA_VERSION,
        entries: [
          { path: "first", enabled: true },
          { path: "nested/./second", enabled: false },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      entries: [
        { path: "first", enabled: true },
        { path: "nested/second", enabled: false },
      ],
    });
    expect(() => parsePluginConfig({ schemaVersion: 2, entries: [] })).toThrow();
    expect(() => parsePluginConfig({ schemaVersion: 1, entries: [], future: true })).toThrow();
    expect(() => normalizePluginConfigPath("../outside")).toThrow(/escape/);
    expect(() => normalizePluginConfigPath("/absolute")).toThrow(/relative/);
  });

  test("reads missing config as empty and atomically persists a valid config", async () => {
    const root = await temporaryRoot();
    expect(await readPluginConfig(root)).toEqual({ schemaVersion: 1, entries: [] });

    await writePluginConfig(
      {
        schemaVersion: 1,
        entries: [
          { path: "first", enabled: true },
          { path: "second", enabled: false },
        ],
      },
      root,
    );

    expect(await readPluginConfig(root)).toEqual({
      schemaVersion: 1,
      entries: [
        { path: "first", enabled: true },
        { path: "second", enabled: false },
      ],
    });
    expect((await readdir(join(root, "plugins"))).toSorted()).toEqual(["config.json"]);
  });

  test("rejects malformed or future config without overwriting it", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "plugins"), { recursive: true });
    const path = pluginConfigPath(root);
    const original = '{"schemaVersion":999,"entries":[]}\n';
    await writeFile(path, original);

    await expect(readPluginConfig(root)).rejects.toThrow(/Invalid plugin config/);
    await expect(writePluginConfig({ schemaVersion: 1, entries: [] }, root)).rejects.toThrow(/Refusing to overwrite/);
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("realpaths user roots and rejects symlink escape from packages", async () => {
    const root = await temporaryRoot();
    const packages = pluginPackagesPath(root);
    const inside = join(packages, "inside");
    const outside = join(root, "outside");
    await Promise.all([mkdir(inside, { recursive: true }), mkdir(outside, { recursive: true })]);
    await symlink(outside, join(packages, "escaped"));

    expect(await resolveUserPluginPath("inside", root)).toBe(inside);
    await expect(resolveUserPluginPath("escaped", root)).rejects.toThrow(/outside/);

    const redirectedState = await temporaryRoot();
    const redirectedPackages = join(redirectedState, "redirected-packages");
    await Promise.all([
      mkdir(join(redirectedState, "plugins"), { recursive: true }),
      mkdir(join(redirectedPackages, "plugin"), { recursive: true }),
    ]);
    await symlink(redirectedPackages, pluginPackagesPath(redirectedState));
    await expect(resolveUserPluginPath("plugin", redirectedState)).rejects.toThrow(/packages directory.*outside/);
  });
});
