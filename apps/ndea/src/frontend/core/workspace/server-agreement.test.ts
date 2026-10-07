/**
 * The browser Workspace and the server evaluator must compute identical
 * outputs for every node of the same document: agents read what users see.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metadata } from "@ndea/protocol";

import { createNativeAppNodeLibrary } from "@/core/node/library";
import { NATIVE_NODE_CONTRIBUTIONS } from "@/core/node/native-nodes";
import { NATIVE_NODE_GRAPH } from "@/core/graph/native-graph";
import { WorkspaceEvaluator, createServerNodeResolver } from "../../../server/graph";
import { loadPreset } from "../../../server/presets";
import { WorkspaceDocumentStore } from "../../../server/workspace";
import { decodeWorkspaceDocument } from "./sync";
import { Workspace } from "./workspace-store";

let dir: string;
beforeEach(async () => {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
  dir = await mkdtemp(join(tmpdir(), "ndea-agreement-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function browserWorkspace(): Workspace {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: createNativeAppNodeLibrary(),
  });
}

describe("browser and server graph evaluation", () => {
  test("every native contribution uses the shared cook table, and the server resolves every native ref", () => {
    const resolver = createServerNodeResolver();
    for (const { definition, graph } of NATIVE_NODE_CONTRIBUTIONS) {
      const shared = NATIVE_NODE_GRAPH[definition.ref.nodeTypeId as keyof typeof NATIVE_NODE_GRAPH];
      expect({ ...graph }).toEqual({ ...shared });
      expect(graph.cook).toBe(shared.cook);
      const server = resolver.getSpecExact(definition.ref)?.definition;
      expect(server && { inputs: server.inputs, outputs: server.outputs }).toEqual({
        inputs: definition.inputs,
        outputs: definition.outputs,
      });
    }
  });

  test("the annotate preset plus filter, dataset, and scope edits evaluate identically everywhere", async () => {
    const preset = await loadPreset("annotate");
    const workspace = browserWorkspace();
    const decoded = decodeWorkspaceDocument(preset, workspace.nodeLibrary);
    if (!decoded.ok) throw new Error(decoded.errors.join("; "));
    workspace.loadDocument(decoded.state);
    const obs = Object.values(workspace.store.state.nodes).find((n) => n.definitionRef.nodeTypeId === "obs")!.id;
    const filter = workspace.addNode("filter", { x: 0, y: 0 });
    workspace.updateNodeConfig(filter, {
      where: {
        op: "and",
        clauses: [
          { op: "gt", column: "t", value: 3 },
          { op: "in", column: "c", values: ["a", "b"] },
        ],
      },
    });
    workspace.connect(obs, filter);
    const dataset = workspace.addNode("dataset", { x: 0, y: 0 });
    workspace.updateNodeConfig(dataset, { datasetKey: "plate'a" });
    const table = Object.values(workspace.store.state.nodes).find((n) => n.definitionRef.nodeTypeId === "table")!.id;
    workspace.connect(filter, table);
    workspace.connect(dataset, table);
    workspace.coordination.assignScope(table, "filter", "agent");
    workspace.coordination.setCoordinationValue("filter", "agent", {
      agent: { where: { op: "eq", column: "infected", value: true } },
    });

    const store = WorkspaceDocumentStore.empty(join(dir, "workspace.json"));
    await store.apply(0, [{ op: "add", path: "", value: workspace.store.state }]);
    const server = new WorkspaceEvaluator(store);

    const ids = Object.keys(workspace.store.state.nodes);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const evaluation = server.evaluate(id);
      expect({ id, value: evaluation.status === "resolved" ? evaluation.value : evaluation }).toEqual({
        id,
        value: workspace.pullGraphNode(id),
      });
    }
    expect(workspace.pullGraphNode(table)).toEqual({
      kind: "pred",
      sql: `((("t" > 3) AND ("c" IN ('a', 'b')))) AND (_dataset = 'plate''a') AND ((("infected" = TRUE)))`,
    });

    // Projection: the same document applied to a fresh preset Workspace cooks the same outputs.
    const projected = browserWorkspace();
    const base = decodeWorkspaceDocument(preset, projected.nodeLibrary);
    const next = decodeWorkspaceDocument(workspace.store.state, projected.nodeLibrary);
    if (!base.ok || !next.ok) throw new Error("decode failed");
    projected.loadDocument(base.state);
    projected.applyDocument(next.state);
    for (const id of ids)
      expect({ id, value: projected.pullGraphNode(id) }).toEqual({ id, value: workspace.pullGraphNode(id) });
    workspace.dispose();
    projected.dispose();
  });
});
