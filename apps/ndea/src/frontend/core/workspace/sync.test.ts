import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceDocumentStore } from "../../../server/workspace";
import { emptyWorkspaceDocument } from "./document";
import { WorkspaceSync, type WorkspaceTransport } from "./sync";
import { Workspace } from "./workspace-store";

let dir: string;
const cleanup: (() => void)[] = [];

beforeEach(async () => {
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

/** A synced session whose dashboard is one count element, `slot-1`. */
async function session(options?: { live?: boolean }) {
  const store = WorkspaceDocumentStore.empty(join(dir, "workspace.json"));
  const workspace = new Workspace();
  workspace.fillSlot("slot-1", "count");
  const initial = { revision: 0, document: emptyWorkspaceDocument() };
  const sync = new WorkspaceSync(workspace, initial, memoryTransport(store, options), (e) => {
    throw new Error(e.join("; "));
  });
  sync.start();
  await sync.flush();
  cleanup.push(() => sync.dispose());
  return { store, workspace, sync };
}

describe("WorkspaceSync", () => {
  test("a seeded document reaches the server, then an edit burst lands as one revision", async () => {
    const { store, workspace, sync } = await session();
    expect(store.snapshot()).toMatchObject({
      revision: 1,
      document: { spec: { elements: { "slot-1": { type: "count" } } } },
    });

    workspace.setElementProps("slot-1", { title: "Cells" });
    workspace.setElementProps("slot-1", { title: "All cells" });
    await sync.flush();
    expect(store.snapshot()).toMatchObject({
      revision: 2,
      document: { spec: { elements: { "slot-1": { props: { title: "All cells" } } } } },
    });
  });

  test("selection and other session state never reach the server document", async () => {
    const { store, workspace, sync } = await session();
    workspace.selectElement("slot-1");
    workspace.setFullscreen("slot-1");
    await sync.flush();
    expect(store.snapshot().revision).toBe(1);
  });

  test("a remote edit applies locally and rebases pending local edits instead of dropping either", async () => {
    const { store, workspace, sync } = await session();
    workspace.setElementProps("slot-1", { title: "Mine" });
    await store.apply(1, [{ op: "add", path: "/data/infected", value: { sql: "infected" } }], "agent");
    await sync.flush();

    expect(store.snapshot()).toMatchObject({
      revision: 3,
      document: {
        data: { infected: { sql: "infected" } },
        spec: { elements: { "slot-1": { props: { title: "Mine" } } } },
      },
    });
    expect(workspace.store.state.data).toEqual({ infected: { sql: "infected" } });
  });

  test("a stale revision (409) replays local ops onto the server document and resends", async () => {
    const { store, workspace, sync } = await session({ live: false });
    await store.apply(1, [{ op: "add", path: "/data/infected", value: { sql: "infected" } }], "agent");
    workspace.setElementProps("slot-1", { title: "Mine" });
    await sync.flush(); // 409 → rebase onto revision 2
    await sync.flush(); // resend on top of it

    expect(store.snapshot()).toMatchObject({
      revision: 3,
      document: {
        data: { infected: { sql: "infected" } },
        spec: { elements: { "slot-1": { props: { title: "Mine" } } } },
      },
    });
  });
});
