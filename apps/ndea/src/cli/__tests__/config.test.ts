import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadProjectConfig, pathsToConfig, resolveLaunchConfig, type ParsedProjectConfig } from "../config.ts";

let projectDir: string;
let configPath: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "ndea-config-"));
  configPath = join(projectDir, "project.yaml");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

async function loadYaml(yaml: string): Promise<ParsedProjectConfig> {
  await Bun.write(configPath, yaml);
  return loadProjectConfig(configPath);
}

describe("project config datasets", () => {
  test("preserves the array form and project options while resolving relative paths", async () => {
    const config = await loadYaml(`
datasets:
  - name: cells
    path: ./data/cells.zarr
    plate_path: images/plate.zarr
    channels:
      DNA:
        color: "#3366ff"
        contrast: [10, 900]
        visible: false
obs_columns: [cell_type, treatment]
settings:
  port: 6060
  host: 0.0.0.0
preset: explore
`);

    expect(config).toEqual({
      datasets: [
        {
          name: "cells",
          path: join(projectDir, "data", "cells.zarr"),
          platePath: join(projectDir, "images", "plate.zarr"),
          channels: {
            DNA: { color: "#3366ff", contrast: [10, 900], visible: false },
          },
        },
      ],
      obsColumns: ["cell_type", "treatment"],
      settings: { port: 6060, host: "0.0.0.0" },
      preset: "explore",
      pluginPaths: undefined,
    });
  });

  for (const dataKey of ["anndata", "path"] as const) {
    for (const plateKey of ["hcs_plate", "ome-zarr", "ome_zarr", "plate_path"] as const) {
      test(`accepts dictionary aliases ${dataKey} + ${plateKey}`, async () => {
        const config = await loadYaml(`
datasets:
  cells:
    ${dataKey}: data/cells.zarr
    ${plateKey}: images/plate.zarr
`);

        expect(config.datasets).toEqual([
          {
            name: "cells",
            path: join(projectDir, "data", "cells.zarr"),
            platePath: join(projectDir, "images", "plate.zarr"),
          },
        ]);
      });
    }
  }

  test("converges equal dictionary aliases", async () => {
    const config = await loadYaml(`
datasets:
  cells:
    anndata: data/cells.zarr
    path: data/cells.zarr
    hcs_plate: images/plate.zarr
    ome-zarr: images/plate.zarr
    ome_zarr: images/plate.zarr
    plate_path: images/plate.zarr
`);

    expect(config.datasets[0]).toEqual({
      name: "cells",
      path: join(projectDir, "data", "cells.zarr"),
      platePath: join(projectDir, "images", "plate.zarr"),
    });
  });

  test("rejects conflicting data aliases and names both owning keys", async () => {
    await expect(
      loadYaml(`
datasets:
  cells:
    anndata: data/a.zarr
    path: data/b.zarr
`),
    ).rejects.toThrow(/Dataset 'cells'.*'anndata'.*'path'/);
  });

  test("rejects conflicting plate aliases and names every defined owning key", async () => {
    await expect(
      loadYaml(`
datasets:
  cells:
    anndata: data/cells.zarr
    hcs_plate: images/a.zarr
    ome-zarr: images/b.zarr
    ome_zarr: images/c.zarr
    plate_path: images/d.zarr
`),
    ).rejects.toThrow(/Dataset 'cells'.*'hcs_plate'.*'ome-zarr'.*'ome_zarr'.*'plate_path'/);
  });
});

describe("project plugin paths", () => {
  test("resolves lexical paths under the YAML directory in declared order", async () => {
    const config = await loadYaml(`
datasets:
  cells:
    anndata: data/cells.zarr
plugin_paths:
  - plugins/first
  - ./plugins/nested/../second
  - .
`);

    expect(config.pluginPaths).toEqual([
      join(projectDir, "plugins", "first"),
      join(projectDir, "plugins", "second"),
      projectDir,
    ]);
  });

  const invalidCases: Array<[string, string, RegExp]> = [
    ["a mapping", "plugin_paths: { plugin: ./plugins/a }", /plugin_paths.*array/],
    ["null", "plugin_paths: null", /plugin_paths.*array/],
    ["a non-string entry", "plugin_paths: [42]", /entry 0.*string/],
    ["an empty entry", 'plugin_paths: [""]', /entry 0.*empty/],
    ["an absolute entry", `plugin_paths: [${JSON.stringify(resolve("/tmp/outside-plugin"))}]`, /entry 0.*relative/],
    ["a NUL entry", 'plugin_paths: ["bad\\u0000path"]', /entry 0.*NUL/],
    ["a parent escape", "plugin_paths: [../outside-plugin]", /entry 0.*escapes/],
    ["a normalized parent escape", "plugin_paths: [plugins/../../outside-plugin]", /entry 0.*escapes/],
  ];

  for (const [label, pluginYaml, expected] of invalidCases) {
    test(`rejects ${label}`, async () => {
      await expect(
        loadYaml(`
datasets:
  cells:
    anndata: data/cells.zarr
${pluginYaml}
`),
      ).rejects.toThrow(expected);
    });
  }
});

describe("launch config", () => {
  const project: ParsedProjectConfig = {
    datasets: [{ name: "cells", path: "/project/cells.zarr" }],
    obsColumns: ["from_yaml"],
    settings: { port: 6060, host: "yaml-host" },
    preset: "yaml-preset",
    pluginPaths: ["/project/plugins/first", "/project/plugins/second"],
  };

  test("uses YAML values when CLI overrides are absent", () => {
    expect(
      resolveLaunchConfig(project, {
        noOpen: false,
        noStatic: true,
      }),
    ).toEqual({
      datasets: project.datasets,
      obsColumns: ["from_yaml"],
      port: 6060,
      host: "yaml-host",
      noOpen: false,
      noStatic: true,
      preset: "yaml-preset",
      pluginPaths: project.pluginPaths,
    });
  });

  test("applies CLI values over YAML while carrying plugin paths unchanged", () => {
    expect(
      resolveLaunchConfig(project, {
        port: 7070,
        host: "cli-host",
        noOpen: true,
        noStatic: false,
        obsColumns: ["from_cli"],
        preset: "cli-preset",
      }),
    ).toEqual({
      datasets: project.datasets,
      obsColumns: ["from_cli"],
      port: 7070,
      host: "cli-host",
      noOpen: true,
      noStatic: false,
      preset: "cli-preset",
      pluginPaths: project.pluginPaths,
    });
  });

  test("keeps existing defaults for bare paths", () => {
    const parsed = pathsToConfig(["relative/example.zarr"]);
    expect(resolveLaunchConfig(parsed, { noOpen: false, noStatic: false })).toEqual({
      datasets: [
        {
          name: "example",
          path: resolve("relative/example.zarr"),
        },
      ],
      obsColumns: undefined,
      port: 5055,
      host: "127.0.0.1",
      noOpen: false,
      noStatic: false,
      preset: undefined,
      pluginPaths: undefined,
    });
  });
});
