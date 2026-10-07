import { describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";
import { predicateSql } from "@/core/graph/cook";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import { WorkspaceEvaluator } from "../../../server/graph";
import { WorkspaceDocumentStore } from "../../../server/workspace";
import { decodeWorkspaceDocument } from "./sync";
import { Workspace } from "./workspace-store";

const library = createNativeAppNodeLibrary();
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
};

function makeWs() {
  return new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: library,
  });
}

const SET = "0123456789abcdef";
const PINNED = `"__row_index__" IN (SELECT __row_index__ FROM ndea_obs_sets WHERE set_id = '${SET}')`;

describe("Cache node", () => {
  test("live output is its input AND its filter scope; a pin replaces both", () => {
    const ws = makeWs();
    const obs = ws.addNode("obs", { x: 0, y: 0 }, "obs");
    const wrangle = ws.addNode("wrangle", { x: 100, y: 0 });
    const cache = ws.addNode("cache", { x: 200, y: 0 });
    ws.connect(obs, wrangle);
    ws.connect(wrangle, cache);
    ws.updateNodeConfig(wrangle, { predicateSql: "x > 1" });
    ws.coordination.assignScope(cache, "filter", "A");
    ws.coordination.setCoordinationValue("filter", "A", { agent: { where: { op: "lt", column: "y", value: 9 } } });
    expect(predicateSql(ws.pullGraphNode(cache))).toBe(`(x > 1) AND ((("y" < 9)))`);

    ws.updateNodeConfig(cache, { pin: { clause: { op: "inSet", set: SET }, count: 2 } });
    ws.coordination.setCoordinationValue("filter", "A", { agent: { where: { op: "gt", column: "y", value: 0 } } });
    expect(predicateSql(ws.pullGraphNode(cache))).toBe(PINNED);

    ws.updateNodeConfig(cache, { pin: null });
    expect(predicateSql(ws.pullGraphNode(cache))).toBe(`(x > 1) AND ((("y" > 0)))`);
    ws.dispose();
  });

  test("a pin survives the document round trip and the server reads the same rows", () => {
    const ws = makeWs();
    const cache = ws.addNode("cache", { x: 0, y: 0 });
    ws.updateNodeConfig(cache, { pin: { clause: { op: "inSet", set: SET }, count: 2 } });
    const document = ws.store.state;

    const reopened = makeWs();
    const decoded = decodeWorkspaceDocument(document, reopened.nodeLibrary);
    if (!decoded.ok) throw new Error(decoded.errors.join("; "));
    reopened.loadDocument(decoded.state);
    expect(predicateSql(reopened.pullGraphNode(cache))).toBe(PINNED);

    const server = new WorkspaceEvaluator(WorkspaceDocumentStore.empty("/tmp/unused.json", document)).evaluate(cache);
    expect(server.status === "resolved" ? server.value.sql : server.status).toBe(PINNED);
    ws.dispose();
    reopened.dispose();
  });
});
