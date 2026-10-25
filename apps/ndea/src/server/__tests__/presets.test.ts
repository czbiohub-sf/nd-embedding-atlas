import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMPONENTS, elementScope } from "../../frontend/core/workspace/dashboard.ts";
import { emptyWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import { loadPreset } from "../presets.ts";
import { Workspace, WorkspaceFileError } from "../workspace.ts";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("presets are workspace documents", () => {
  test("a missing workspace file is written from exploration: two layouts of views linked on scope A", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndea-preset-"));
    const path = join(dir, "workspace.json");
    const workspace = await Workspace.open(path, () => loadPreset("exploration"), { validate: async () => [] });
    expect(await Bun.file(path).json()).toMatchObject({ format: "ndea.workspace", version: 3, revision: 1 });

    const document = workspace.get().document as WorkspaceDocument;
    expect(document.layout).toBe("exploration");
    expect(Object.values(document.layouts).map((layout) => layout.name)).toEqual(["Exploration", "Review"]);
    expect(document.layouts.exploration.spec.elements.bottom).toEqual({
      type: "tabs",
      props: { active: "table" },
      children: ["table", "histogram"],
    });
    const views = (layout: string) =>
      Object.values(document.layouts[layout].spec.elements).filter((element) => COMPONENTS[element.type].view);
    const bound = (layout: string, type: "focus" | "filter") =>
      views(layout)
        .filter((element) => elementScope(element, type) === "A")
        .map((element) => element.type)
        .toSorted();
    expect(bound("exploration", "focus")).toEqual(["gallery", "image-viewer", "scatter", "table"]);
    expect(bound("exploration", "filter")).toEqual(["gallery", "histogram", "scatter", "table"]);
    expect(bound("review", "focus")).toEqual(["gallery", "image-viewer", "table"]);
    expect(bound("review", "filter")).toEqual(["gallery", "table"]);
  });

  test("a .json path is a preset; unknown names and invalid documents are refused", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndea-preset-"));
    const valid = join(dir, "empty.json");
    await Bun.write(valid, JSON.stringify(emptyWorkspaceDocument()));
    expect(await loadPreset(valid)).toEqual(emptyWorkspaceDocument());

    await expect(loadPreset("nope")).rejects.toThrow('unknown preset "nope"');

    const invalid = join(dir, "invalid.json");
    const ghost = {
      ...emptyWorkspaceDocument(),
      layouts: { main: { name: "Main", spec: { root: "ghost", elements: {} } } },
    };
    await Bun.write(invalid, JSON.stringify(ghost));
    const refused = loadPreset(invalid);
    await expect(refused).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(refused).rejects.toThrow("/layouts/main/spec/root");
  });
});
