import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metadata } from "@ndea/protocol";

import { createNativeAppNodeLibrary } from "../../frontend/core/node/library.ts";
import { emptyWorkspaceDocument } from "../../frontend/core/workspace/document.ts";
import { decodeWorkspaceDocument } from "../../frontend/core/workspace/sync.ts";
import { Workspace } from "../../frontend/core/workspace/workspace-store.ts";
import { loadPreset } from "../presets.ts";
import { WorkspaceFileError } from "../workspace.ts";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("presets are workspace documents", () => {
  test("annotate opens with its five views on the Stage and its views linked on scopes A", async () => {
    globalThis.requestAnimationFrame = () => 0;
    const workspace = new Workspace({
      coordinator: { query: () => Promise.resolve([]) } as never,
      table: "atlas",
      metadata: { dataset_keys: [] } as unknown as Metadata,
      nodeLibrary: createNativeAppNodeLibrary(),
    });
    const decoded = decodeWorkspaceDocument(await loadPreset("annotate"), workspace.nodeLibrary);
    if (!decoded.ok) throw new Error(decoded.errors.join("; "));
    workspace.loadDocument(decoded.state);
    const typeOf = (id: string): string => workspace.store.state.nodes[id].definitionRef.nodeTypeId;

    expect(workspace.stagedIds().map(typeOf).toSorted()).toEqual([
      "annotate",
      "gallery",
      "image-viewer",
      "scatter",
      "table",
    ]);
    const bound = (type: "focus" | "filter") =>
      Object.keys(workspace.store.state.nodes)
        .filter((id) => workspace.coordination.scopeOf(id, type) === "A")
        .map(typeOf)
        .toSorted();
    expect(bound("focus")).toEqual(["annotate", "gallery", "image-viewer", "scatter", "table"]);
    expect(bound("filter")).toEqual(["cache", "scatter", "table"]);
    workspace.dispose();
  });

  test("a .json path is a preset; unknown names and invalid documents are refused", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndea-preset-"));
    const valid = join(dir, "empty.json");
    await Bun.write(valid, JSON.stringify(emptyWorkspaceDocument()));
    expect(await loadPreset(valid)).toEqual(emptyWorkspaceDocument());

    await expect(loadPreset("nope")).rejects.toThrow('unknown preset "nope"');

    const invalid = join(dir, "invalid.json");
    await Bun.write(invalid, JSON.stringify({ ...emptyWorkspaceDocument(), stage: { root: "ghost", elements: {} } }));
    const refused = loadPreset(invalid);
    await expect(refused).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(refused).rejects.toThrow("/stage/root");
  });
});
