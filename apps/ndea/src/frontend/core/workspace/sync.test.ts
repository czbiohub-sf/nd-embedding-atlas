import { afterEach, describe, expect, test } from "bun:test";
import type { JsonPatchOp } from "@ndea/protocol";

import { Workspace, type WorkspacePatchResult } from "../../../server/workspace";
import { emptyWorkspaceDocument } from "./document";
import { WorkspaceSync, type PatchOutcome, type WorkspaceTransport } from "./sync";
import { WorkspaceStore } from "./workspace-store";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

const outcome = (result: WorkspacePatchResult): PatchOutcome =>
  result.kind === "invalid" ? { kind: "invalid", errors: result.issues.map((i) => i.detail) } : result;

/** The real server workspace behind an in-process transport; `live: false` drops watch pushes. */
function memoryTransport(server: Workspace, { live = true } = {}): WorkspaceTransport {
  const actor = { kind: "browser" } as const;
  return {
    patch: async (base, ops, clientId) => outcome(await server.patch(ops, { base, actor, clientId })),
    watch: (onChange) => (live ? server.watch(onChange) : () => {}),
    snapshot: () => Promise.resolve(server.get()),
  };
}

const agentWrite = (server: Workspace, base: number, ops: JsonPatchOp[]) =>
  server.patch(ops, { base, actor: { kind: "mcp", agent: "omp" } });

/** A synced session whose dashboard is one count element, `slot-1`. */
async function session(options?: { live?: boolean }) {
  const server = Workspace.memory();
  const workspace = new WorkspaceStore();
  workspace.fillSlot("slot-1", "count");
  const initial = { revision: 0, document: emptyWorkspaceDocument() };
  const sync = new WorkspaceSync(workspace, initial, memoryTransport(server, options), (e) => {
    throw new Error(e.join("; "));
  });
  sync.start();
  await sync.flush();
  cleanup.push(() => sync.dispose());
  return { server, workspace, sync };
}

describe("WorkspaceSync", () => {
  test("a seeded document reaches the server, then an edit burst lands as one revision", async () => {
    const { server, workspace, sync } = await session();
    expect(server.get()).toMatchObject({
      revision: 1,
      document: { spec: { elements: { "slot-1": { type: "count" } } } },
    });

    workspace.setElementProps("slot-1", { title: "Cells" });
    workspace.setElementProps("slot-1", { title: "All cells" });
    await sync.flush();
    expect(server.get()).toMatchObject({
      revision: 2,
      document: { spec: { elements: { "slot-1": { props: { title: "All cells" } } } } },
    });
  });

  test("selection and other session state never reach the server document", async () => {
    const { server, workspace, sync } = await session();
    workspace.selectElement("slot-1");
    workspace.setFullscreen("slot-1");
    await sync.flush();
    expect(server.get().revision).toBe(1);
  });

  test("a remote edit applies locally and rebases pending local edits instead of dropping either", async () => {
    const { server, workspace, sync } = await session();
    workspace.setElementProps("slot-1", { title: "Mine" });
    await agentWrite(server, 1, [{ op: "add", path: "/data/infected", value: { sql: "infected" } }]);
    await sync.flush();

    expect(server.get()).toMatchObject({
      revision: 3,
      document: {
        data: { infected: { sql: "infected" } },
        spec: { elements: { "slot-1": { props: { title: "Mine" } } } },
      },
    });
    expect(workspace.snapshot().data).toEqual({ infected: { sql: "infected" } });
  });

  test("a stale revision (409) replays local ops onto the server document and resends", async () => {
    const { server, workspace, sync } = await session({ live: false });
    await agentWrite(server, 1, [{ op: "add", path: "/data/infected", value: { sql: "infected" } }]);
    workspace.setElementProps("slot-1", { title: "Mine" });
    await sync.flush(); // 409 → rebase onto revision 2
    await sync.flush(); // resend on top of it

    expect(server.get()).toMatchObject({
      revision: 3,
      document: {
        data: { infected: { sql: "infected" } },
        spec: { elements: { "slot-1": { props: { title: "Mine" } } } },
      },
    });
  });
});
