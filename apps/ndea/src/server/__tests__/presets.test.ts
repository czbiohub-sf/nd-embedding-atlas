import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMPONENTS, elementScope } from "../../frontend/core/workspace/dashboard.ts";
import { emptyWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../../frontend/core/workspace/types.ts";
import { loadPreset } from "../presets.ts";
import { WorkspaceDocumentStore, WorkspaceFileError } from "../workspace.ts";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("presets are workspace documents", () => {
  test("a missing workspace file is written from annotate: five views linked on scope A", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndea-preset-"));
    const path = join(dir, "workspace.json");
    const store = await WorkspaceDocumentStore.open(path, () => loadPreset("annotate"));
    expect(await Bun.file(path).json()).toMatchObject({ format: "ndea.workspace", version: 2, revision: 1 });

    const document = store.snapshot().document as WorkspaceDocument;
    const views = Object.values(document.spec.elements).filter((element) => COMPONENTS[element.type].view);
    const bound = (type: "focus" | "filter") =>
      views
        .filter((element) => elementScope(element, type) === "A")
        .map((element) => element.type)
        .toSorted();
    expect(views.map((element) => element.type).toSorted()).toEqual([
      "annotate",
      "gallery",
      "image-viewer",
      "scatter",
      "table",
    ]);
    expect(bound("focus")).toEqual(["annotate", "gallery", "image-viewer", "scatter", "table"]);
    expect(bound("filter")).toEqual(["annotate", "gallery", "scatter", "table"]);
  });

  test("a .json path is a preset; unknown names and invalid documents are refused", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndea-preset-"));
    const valid = join(dir, "empty.json");
    await Bun.write(valid, JSON.stringify(emptyWorkspaceDocument()));
    expect(await loadPreset(valid)).toEqual(emptyWorkspaceDocument());

    await expect(loadPreset("nope")).rejects.toThrow('unknown preset "nope"');

    const invalid = join(dir, "invalid.json");
    await Bun.write(invalid, JSON.stringify({ ...emptyWorkspaceDocument(), spec: { root: "ghost", elements: {} } }));
    const refused = loadPreset(invalid);
    await expect(refused).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(refused).rejects.toThrow("/spec/root");
  });
});
