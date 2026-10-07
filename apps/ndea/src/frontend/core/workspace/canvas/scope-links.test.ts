import { beforeEach, describe, expect, test } from "bun:test";
import type { Metadata } from "@ndea/protocol";

import { bindingScope } from "@/core/coordination/types";
import { createNativeAppNodeLibrary } from "@/core/node/library";
import { loadPreset } from "../../../../server/presets";
import { decodeWorkspaceDocument } from "../sync";
import { Workspace } from "../workspace-store";
import { parseScopeHubId, parseScopeLinkId, projectScopeLinks } from "./scope-links";

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
});

async function presetWorkspace(): Promise<Workspace> {
  const ws = new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: createNativeAppNodeLibrary(),
  });
  const decoded = decodeWorkspaceDocument(await loadPreset("annotate"), ws.nodeLibrary);
  if (!decoded.ok) throw new Error(decoded.errors.join("; "));
  ws.loadDocument(decoded.state);
  return ws;
}

const rootLinks = (ws: Workspace) =>
  projectScopeLinks(ws.store.state, new Set(Object.keys(ws.store.state.nodes))).links.map((link) => link.id);

describe("scope links: the canvas lens over coordination bindings", () => {
  test("get: every binding projects to exactly one link that parses back to it", async () => {
    const ws = await presetWorkspace();
    const { bindings } = ws.store.state;
    const { hubs, links } = projectScopeLinks(ws.store.state, new Set(Object.keys(ws.store.state.nodes)));

    const bindingCount = Object.values(bindings).reduce((sum, byType) => sum + Object.keys(byType).length, 0);
    expect(links.length).toBe(bindingCount);
    for (const link of links) {
      const parsed = parseScopeLinkId(link.id)!;
      expect(bindingScope(parsed.type, bindings[parsed.node]?.[parsed.type])).toBe(link.scope);
      expect(parseScopeHubId(link.hub)).toEqual({ type: parsed.type, scope: link.scope });
    }
    expect(new Set(hubs.map((hub) => hub.id))).toEqual(new Set(links.map((link) => link.hub)));
    // nodes on another level contribute nothing
    expect(projectScopeLinks(ws.store.state, new Set()).links).toEqual([]);
    ws.dispose();
  });

  test("put: deleting a link clears only its binding; relinking restores it; a no-op link writes nothing", async () => {
    const ws = await presetWorkspace();
    const before = rootLinks(ws);
    const target = before.find((id) => id.startsWith("bind:filter:"))!;
    const { type, node } = parseScopeLinkId(target)!;
    const scope = ws.coordination.scopeOf(node, type)!;

    ws.coordination.clearScope(node, type);
    expect(rootLinks(ws)).toEqual(before.filter((id) => id !== target));

    ws.coordination.assignScope(node, type, scope);
    expect(new Set(rootLinks(ws))).toEqual(new Set(before));

    const document = ws.store.state;
    ws.coordination.assignScope(node, type, scope);
    expect(ws.store.state).toBe(document);
    ws.dispose();
  });
});
