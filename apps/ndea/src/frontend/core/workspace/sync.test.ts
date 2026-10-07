import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metadata } from "@ndea/protocol";

import { createNativeAppNodeLibrary } from "@/core/node/library";
import { WorkspaceDocumentStore } from "../../../server/workspace";
import { emptyWorkspaceDocument } from "./document";
import { WorkspaceSync, type WorkspaceTransport } from "./sync";
import { Workspace } from "./workspace-store";

const library = createNativeAppNodeLibrary();
let dir: string;
const cleanup: (() => void)[] = [];

beforeEach(async () => {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  };
  dir = await mkdtemp(join(tmpdir(), "ndea-sync-"));
});
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) dispose();
  await rm(dir, { recursive: true, force: true });
});

/** The real server store behind an in-process transport; `live: false` drops watch pushes. */
function memoryTransport(store: WorkspaceDocumentStore, { live = true } = {}): WorkspaceTransport {
  return {
    async patch(baseRevision, ops, clientId) {
      const result = await store.apply(baseRevision, ops, clientId);
      return result.kind === "invalid" ? { kind: "invalid", errors: result.issues.map((i) => i.detail) } : result;
    },
    watch: (onChange) => (live ? store.watch(onChange) : () => {}),
    snapshot: () => Promise.resolve(store.snapshot()),
  };
}

async function session(options?: { live?: boolean }) {
  const store = WorkspaceDocumentStore.empty(join(dir, "workspace.json"));
  const workspace = new Workspace({
    coordinator: { query: () => Promise.resolve([]) } as never,
    table: "atlas",
    metadata: { dataset_keys: [] } as unknown as Metadata,
    nodeLibrary: library,
  });
  const obs = workspace.addNode("obs", { x: 0, y: 0 });
  const initial = { revision: 0, document: emptyWorkspaceDocument() };
  const sync = new WorkspaceSync(workspace, initial, memoryTransport(store, options), (e) => {
    throw new Error(e.join("; "));
  });
  sync.start();
  await sync.flush();
  cleanup.push(
    () => sync.dispose(),
    () => workspace.dispose(),
  );
  return { store, workspace, sync, obs };
}

describe("WorkspaceSync", () => {
  test("a seeded document reaches the server, then an edit burst lands as one revision", async () => {
    const { store, workspace, sync, obs } = await session();
    expect(store.snapshot()).toMatchObject({ revision: 1, document: { nodes: { [obs]: { id: obs } } } });

    workspace.setStripH(400);
    workspace.setStripH(410);
    await sync.flush();
    expect(store.snapshot()).toMatchObject({ revision: 2, document: { stripH: 410 } });
  });

  test("selection and other session state never reach the server document", async () => {
    const { store, workspace, sync, obs } = await session();
    workspace.selectNode(obs);
    await sync.flush();
    expect(store.snapshot().revision).toBe(1);
    expect(store.snapshot().document).not.toHaveProperty("selectedNodeId");
  });

  test("a remote edit applies locally and rebases pending local edits instead of dropping either", async () => {
    const { store, workspace, sync, obs } = await session();
    workspace.setStripH(500);
    await store.apply(1, [{ op: "add", path: `/formLocked/${obs}`, value: true }], "agent");
    await sync.flush();

    expect(store.snapshot()).toMatchObject({ revision: 3, document: { formLocked: { [obs]: true }, stripH: 500 } });
    expect(workspace.store.state).toMatchObject({ formLocked: { [obs]: true }, stripH: 500 });
  });

  test("nodes and edges an agent adds are live in the local graph, not inert records", async () => {
    const { store, workspace, obs } = await session();
    const where = { op: "eq", column: "condition", value: "infected" };
    await store.apply(
      1,
      [
        {
          op: "add",
          path: "/nodes/agent-filter",
          value: {
            id: "agent-filter",
            definitionRef: { nodeTypeId: "filter", nodeTypeVersion: "1.0.0" },
            label: "Filter",
            config: { version: 1, value: { where } },
          },
        },
        {
          op: "add",
          path: "/edges/agent-edge",
          value: { id: "agent-edge", from: obs, fromPort: "out", to: "agent-filter", toPort: "in", kind: "pred" },
        },
      ],
      "agent",
    );
    await Promise.resolve();
    expect(workspace.pullGraphNode("agent-filter")).toEqual({ kind: "pred", sql: `("condition" = 'infected')` });
  });

  test("a stale revision (409) replays local ops onto the server document and resends", async () => {
    const { store, workspace, sync, obs } = await session({ live: false });
    await store.apply(1, [{ op: "add", path: `/formLocked/${obs}`, value: true }], "agent");
    workspace.setStripH(600);
    await sync.flush(); // 409 → rebase onto revision 2
    await sync.flush(); // resend on top of it

    expect(store.snapshot()).toMatchObject({ revision: 3, document: { formLocked: { [obs]: true }, stripH: 600 } });
    expect(workspace.store.state).toMatchObject({ formLocked: { [obs]: true }, stripH: 600 });
  });
});
