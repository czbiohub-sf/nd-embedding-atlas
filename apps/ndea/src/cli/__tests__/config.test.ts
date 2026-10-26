import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  loadProjectConfig,
  pathsToConfig,
  resolveLaunchConfig,
  type ParsedProjectConfig,
  type ProjectDatasetMount,
} from "../config.ts";
import { defaultWorkspacePath } from "../lib/paths.ts";

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

const DATASET_ALIAS_CASES = (["anndata", "path"] as const).flatMap((dataKey) =>
  (["hcs_plate", "ome-zarr", "ome_zarr", "plate_path"] as const).map((plateKey) => [dataKey, plateKey] as const),
);

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
settings:
  port: 6060
  host: 0.0.0.0
preset: explore
`);

    const cells: ProjectDatasetMount = {
      name: "cells",
      path: join(projectDir, "data", "cells.zarr"),
      platePath: join(projectDir, "images", "plate.zarr"),
      channels: {
        DNA: { color: "#3366ff", contrast: [10, 900], visible: false },
      },
    };
    expect(config).toEqual({
      datasets: [cells],
      // No `collections:`: one implicit collection, named after the project file.
      collections: [{ name: "project", datasets: [cells] }],
      settings: { port: 6060, host: "0.0.0.0" },
      preset: "explore",
    });
  });

  test.each(DATASET_ALIAS_CASES)("accepts dictionary aliases %s + %s", async (dataKey, plateKey) => {
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

const names = (config: ParsedProjectConfig) => config.collections.map((c) => [c.name, c.datasets.map((d) => d.name)]);

describe("project config collections", () => {
  const DATASETS = `
datasets:
  a: { anndata: a.zarr }
  b: { anndata: b.zarr }
  c: { anndata: c.zarr }
`;

  test("accepts the array and map forms; a dataset may be in several; the rest form the implicit collection", async () => {
    const listed = await loadYaml(`${DATASETS}
collections:
  - name: first
    datasets: [a]
  - name: both
    datasets: [a, b]
`);
    expect(names(listed)).toEqual([
      ["first", ["a"]],
      ["both", ["a", "b"]],
      ["project", ["c"]],
    ]);
    expect(listed.collections[1].datasets[1]).toBe(listed.datasets[1]);

    const keyed = await loadYaml(`${DATASETS}
collections:
  all: { datasets: [c, b, a] }
`);
    expect(names(keyed)).toEqual([["all", ["c", "b", "a"]]]);
  });

  test.each([
    ["an unknown dataset", "collections:\n  x: { datasets: [a, nope] }", /Collection 'x': unknown dataset "nope"/],
    [
      "a duplicate name",
      "collections:\n  - { name: x, datasets: [a] }\n  - { name: x, datasets: [b, c] }",
      /Collection 'x' is defined twice/,
    ],
    [
      "a name clashing with the implicit collection",
      "collections:\n  project: { datasets: [a] }",
      /'project' clashes with the implicit collection.*\(b, c\)/,
    ],
    ["no datasets", "collections:\n  x: { datasets: [] }", /Collection 'x' must list its datasets/],
    ["a dataset listed twice", "collections:\n  x: { datasets: [a, a] }", /Collection 'x' lists a dataset twice/],
    ["a missing name", "collections:\n  - { datasets: [a] }", /Collection entry 0 must have a 'name'/],
  ])("rejects %s", async (_, yaml, error) => {
    await expect(loadYaml(`${DATASETS}${yaml}\n`)).rejects.toThrow(error);
  });

  test("--collection picks one; the default is the first; an unknown name lists the choices", async () => {
    const project = await loadYaml(`${DATASETS}
collections:
  first: { datasets: [a] }
  second: { datasets: [b, c] }
`);
    const overrides = { noOpen: false, dev: false };
    expect(resolveLaunchConfig(project, overrides).collection).toBe("first");
    expect(resolveLaunchConfig(project, { ...overrides, collection: "second" }).collection).toBe("second");
    expect(() => resolveLaunchConfig(project, { ...overrides, collection: "third" })).toThrow(
      "unknown collection 'third' (collections: first, second)",
    );
    // Every collection shares the project's one workspace file.
    expect(resolveLaunchConfig(project, { ...overrides, collection: "second" }).workspace).toBe(
      resolveLaunchConfig(project, overrides).workspace,
    );
  });
});

describe("launch config", () => {
  const cells = { name: "cells", path: "/project/cells.zarr" };
  const project: ParsedProjectConfig = {
    datasets: [cells],
    collections: [{ name: "project", datasets: [cells] }],
    settings: { port: 6060, host: "yaml-host" },
    preset: "yaml-preset",
  };

  test("uses YAML values when CLI overrides are absent", () => {
    expect(
      resolveLaunchConfig(project, {
        noOpen: false,
        dev: true,
      }),
    ).toEqual({
      collections: project.collections,
      collection: "project",
      port: 6060,
      host: "yaml-host",
      noOpen: false,
      dev: true,
      preset: "yaml-preset",
      workspace: defaultWorkspacePath(["/project/cells.zarr"]),
    });
  });

  test("applies CLI values over YAML", () => {
    expect(
      resolveLaunchConfig(project, {
        port: 7070,
        host: "cli-host",
        noOpen: true,
        dev: false,
        preset: "cli-preset",
        workspace: "relative/workspace.json",
      }),
    ).toEqual({
      collections: project.collections,
      collection: "project",
      port: 7070,
      host: "cli-host",
      noOpen: true,
      dev: false,
      preset: "cli-preset",
      workspace: resolve("relative/workspace.json"),
    });
  });

  test("keeps existing defaults for bare paths", () => {
    const parsed = pathsToConfig(["relative/example.zarr"]);
    const example = { name: "example", path: resolve("relative/example.zarr") };
    expect(resolveLaunchConfig(parsed, { noOpen: false, dev: false })).toEqual({
      collections: [{ name: "example", datasets: [example] }],
      collection: "example",
      port: 5055,
      host: "127.0.0.1",
      noOpen: false,
      dev: false,
      preset: undefined,
      workspace: defaultWorkspacePath([resolve("relative/example.zarr")]),
    });
  });
});
