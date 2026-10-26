import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMcpEndpoint } from "../mcp.ts";
import { handleHarnessGet, handleHarnessMode, handleProposalAccept, handleProposalReject } from "../routes/harness.ts";
import { createServerSession, type DatasetMountConfig } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";
import { WorkspaceHistorySchema, type HarnessEvent } from "@ndea/protocol";

const TOKEN = "test-token";
let dir: string;
let store: DatasetQuerySession | null = null;
let client: Client | null = null;
afterEach(async () => {
  await client?.close();
  client = null;
  store?.close();
  store = null;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function connect(agent?: string) {
  dir = await mkdtemp(join(tmpdir(), "ndea-mcp-"));
  store = await DatasetQuerySession.fromInit(async (conn: DuckDBConnection) => {
    await conn.run(
      `CREATE TABLE obs_base AS SELECT * FROM (VALUES
        (0, '0', 'plate_a', 'infected', 10.0),
        (1, '1', 'plate_a', 'mock', 50.0),
        (2, '0', 'plate_b', 'infected', 90.0)
      ) AS t(__row_index__, obs_name, _dataset, condition, area)`,
    );
  });
  const state = createServerSession({
    store,
    observationSetsDirectory: join(dir, "sets"),
    datasets: new Map<string, DatasetMountConfig>([
      ["plate_a", { path: "/a.zarr" }],
      ["plate_b", { path: "/b.zarr" }],
    ]),
  });
  const endpoint = createMcpEndpoint(state, TOKEN);
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost:5055/mcp"), {
    fetch: (url, init) => {
      const request = new Request(url, init);
      request.headers.set("host", "localhost:5055");
      request.headers.set("authorization", `Bearer ${TOKEN}`);
      if (agent !== undefined) request.headers.set("x-ndea-agent", agent);
      return endpoint(request);
    },
  });
  client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return { client, endpoint, workspace: state.workspace, harness: state.harness };
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client!.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, any> };
}

describe("ndea MCP", () => {
  test("refuses a missing token and a non-loopback Host or Origin before any MCP handling", async () => {
    const { endpoint } = await connect();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = {
      host: "localhost:5055",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    const anonymous = await endpoint(new Request("http://localhost:5055/mcp", { method: "POST", headers, body }));
    expect(anonymous.status).toBe(401);

    const status = async (host: string, origin?: string) => {
      const authorized = { ...headers, host, authorization: `Bearer ${TOKEN}`, ...(origin ? { origin } : {}) };
      return (await endpoint(new Request("http://localhost:5055/mcp", { method: "POST", headers: authorized, body })))
        .status;
    };
    // portless dev URLs (`ndea.localhost`, `<branch>.ndea.localhost`) are loopback names too.
    expect(await status("ndea.localhost")).not.toBe(403);
    expect(await status("fix-ui.ndea.localhost:1355", "http://fix-ui.ndea.localhost:1355")).not.toBe(403);
    expect(await status("127.0.0.1:5055", "https://ndea.localhost")).not.toBe(403);
    expect(await status("evil.example")).toBe(403);
    expect(await status("localhost.evil.example")).toBe(403);
    expect(await status("localhost:5055", "https://evil.example")).toBe(403);
    expect(await status("localhost:5055", "https://localhost.evil.example")).toBe(403);
    expect(await status("localhost:5055", "null")).toBe(403);
  });

  test("an agent builds a filtered, linked dashboard and reads the same numbers back", async () => {
    const { workspace, harness } = await connect();
    harness.setMode("direct");
    const tools = (await client!.listTools()).tools.map((tool) => tool.name).toSorted();
    expect(tools).toEqual([
      "create_observation_set",
      "edit_dashboard",
      "get_history",
      "get_proposal",
      "get_result",
      "get_workspace",
      "list_collections",
      "list_columns",
      "list_components",
      "patch_workspace",
      "restore_revision",
    ]);

    const components = (await call("list_components", {})).body.components as Record<string, any>[];
    const vgplot = components.find((component) => component.type === "vgplot")!;
    expect(vgplot).toMatchObject({ children: "none", reads: true, binds: ["filter"] });
    expect(Object.keys(vgplot.props.properties).toSorted()).toEqual(["attributes", "entries"]);

    const column = await call("list_columns", { column: "condition" });
    expect(column.body.values).toEqual([
      { value: "infected", count: 2 },
      { value: "mock", count: 1 },
    ]);

    const built = await call("edit_dashboard", {
      ops: [
        { op: "set_data", name: "infected", source: { where: { op: "eq", column: "condition", value: "infected" } } },
        { op: "add", type: "count", props: { data: "infected" } },
        { op: "add", type: "table", at: { beside: "count-1" } },
        { op: "bind", id: "count-1", type: "filter", scope: "A" },
        { op: "bind", id: "table-1", type: "filter", scope: "A" },
        {
          op: "set_filter",
          scope: "A",
          source: "agent",
          facet: "area",
          clause: { op: "gt", column: "area", value: 40 },
        },
      ],
    });
    expect(built.isError).toBe(false);
    expect(built.body.added.toSorted()).toEqual(["count-1", "split-1", "table-1"]);
    expect((await call("get_result", { element: "count-1" })).body).toMatchObject({ count: 1 });
    expect((await call("get_result", { element: "table-1" })).body).toMatchObject({ count: 2 });
    expect((await call("get_result", { data: "infected" })).body).toMatchObject({ count: 2 });

    const read = (await call("get_workspace", {})).body;
    expect(read.revision).toBe(workspace.get().revision);
    expect(read.document.state.filter.A).toEqual({ agent: { area: { op: "gt", column: "area", value: 40 } } });

    const tabbed = await call("edit_dashboard", {
      ops: [
        { op: "add_tab", tile: "table-1", type: "histogram", id: "hist", props: { field: "area" } },
        { op: "add_layout", id: "review", name: "Review", from: "main" },
        { op: "set_active_layout", id: "review" },
        { op: "move_tab", id: "hist", to: "count-1" },
        { op: "close_tab", id: "table-1" },
      ],
    });
    expect(tabbed.isError).toBe(false);
    const doc = (await call("get_workspace", {})).body.document;
    expect(doc.layout).toBe("review");
    expect(Object.keys(doc.layouts)).toEqual(["main", "review"]);
    const main = Object.values(doc.layouts.main.spec.elements as Record<string, Record<string, unknown>>);
    expect(main.filter((element) => element.type === "tabs")).toEqual([
      { type: "tabs", props: { active: "hist" }, children: ["count-1", "hist"] },
    ]);
    expect(doc.layouts.main.spec.elements["table-1"]).toBeUndefined();
    expect(Object.keys(doc.layouts.review.spec.elements)).not.toContain("count-1");
    expect((await call("get_result", { element: "hist" })).body).toMatchObject({ count: 3 });
    expect((await call("create_observation_set", { element: "count-1" })).body.count).toBe(1);
  });

  test("invalid edits are refused whole, with a pointer to fix, and change nothing", async () => {
    const { workspace, harness } = await connect();
    const before = workspace.get().revision;

    const missing = await call("edit_dashboard", {
      ops: [
        { op: "add", type: "count" },
        { op: "add", type: "count", at: { slot: "ghost" } },
      ],
    });
    expect(missing.isError).toBe(true);
    expect(missing.body.issues[0].pointer).toBe("/ops/1");

    const badProp = await call("edit_dashboard", { ops: [{ op: "add", type: "histogram", props: { bins: "many" } }] });
    expect(badProp.isError).toBe(true);
    expect(badProp.body.issues[0].pointer).toBe("/layouts/main/spec/elements/histogram-1/props/bins");

    const incapable = await call("edit_dashboard", {
      ops: [
        { op: "add", type: "text", props: { text: "hi" } },
        { op: "bind", id: "text-1", type: "filter", scope: "A" },
      ],
    });
    expect(incapable.body.issues[0].pointer).toBe("/layouts/main/spec/elements/text-1/props/filter");

    harness.setMode("direct");
    const patch = await call("patch_workspace", {
      revision: before,
      ops: [{ op: "add", path: "/data/bad", value: { from: "ghost" } }],
    });
    expect(patch.body.issues[0].pointer).toBe("/data/bad/from");

    const stale = await call("edit_dashboard", { revision: before + 1, ops: [{ op: "add", type: "count" }] });
    expect(stale.body).toMatchObject({ revision: before });

    expect(workspace.get().revision).toBe(before);
  });

  test("writes are stamped mcp with the X-Ndea-Agent name; history and restore tools", async () => {
    const { workspace, harness } = await connect("omp");
    harness.setMode("direct");
    await call("edit_dashboard", { ops: [{ op: "set_data", name: "a", source: { sql: "area > 20" } }] });
    await call("patch_workspace", { revision: 1, ops: [{ op: "remove", path: "/data/a" }] });
    const history = WorkspaceHistorySchema.parse((await call("get_history", { limit: 5 })).body).revisions;
    expect(history.map((r) => [r.revision, r.actor])).toEqual([
      [2, { kind: "mcp", agent: "omp" }],
      [1, { kind: "mcp", agent: "omp" }],
    ]);

    expect((await call("restore_revision", { revision: 9 })).isError).toBe(true);
    expect((await call("restore_revision", { revision: 1, revision_base: 0 })).body).toMatchObject({ revision: 2 });
    expect((await call("restore_revision", { revision: 1 })).body).toEqual({ revision: 3, restoredFrom: 1 });
    expect(workspace.get().document).toEqual(workspace.at(1)!.document);
    expect(workspace.history({ limit: 1 })[0]).toMatchObject({ restoredFrom: 1, actor: { kind: "mcp", agent: "omp" } });
  });

  test("a malformed X-Ndea-Agent is dropped, leaving the actor mcp", async () => {
    const { workspace, harness } = await connect("not an agent!");
    harness.setMode("direct");
    await call("edit_dashboard", { ops: [{ op: "set_data", name: "a", source: { sql: "area > 20" } }] });
    expect(workspace.history()[0].actor).toEqual({ kind: "mcp" });
  });
});

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

describe("harness proposals", () => {
  test("edits become a proposal; filters apply directly; accept commits as the agent; reject; get_proposal", async () => {
    const { workspace, harness } = await connect("omp");
    const state = { workspace, harness };
    const proposed = await call("edit_dashboard", {
      ops: [
        { op: "add", type: "count", id: "c" },
        {
          op: "set_filter",
          scope: "A",
          source: "agent",
          facet: "area",
          clause: { op: "gt", column: "area", value: 40 },
        },
        { op: "add", type: "histogram", props: { field: "area" }, at: { beside: "c" } },
      ],
    });
    expect(proposed.isError).toBe(false);
    expect(proposed.body).toMatchObject({
      status: "proposed",
      changes: [
        { index: 0, summary: "Add Count" },
        { index: 1, summary: "Add Histogram beside Count" },
      ],
      filters: { revision: 1, count: 1 },
    });
    const id = proposed.body.id as string;
    // The filter applied at once; the views wait.
    expect(workspace.get().revision).toBe(1);
    expect((workspace.get().document as any).state.filter.A.agent.area).toMatchObject({ op: "gt" });
    expect(harness.state().proposals.map((p) => p.id)).toEqual([id]);

    const accepted = await (
      await handleProposalAccept(post(`/api/proposals/${id}/accept`, { changes: [0] }), id, state)
    ).json();
    expect(accepted).toMatchObject({
      revision: 2,
      proposal: { changes: [{ status: "accepted" }, { status: "pending" }] },
    });
    expect(workspace.history({ limit: 1 })[0]).toMatchObject({ revision: 2, actor: { kind: "mcp", agent: "omp" } });
    expect((await call("get_proposal", { id })).body.changes.map((c: any) => c.status)).toEqual([
      "accepted",
      "pending",
    ]);

    const rejected = await (await handleProposalReject(post(`/api/proposals/${id}/reject`, {}), id, state)).json();
    expect(rejected.proposal.changes.map((c: any) => c.status)).toEqual(["accepted", "rejected"]);
    expect(workspace.get().revision).toBe(2);
    expect(harness.state().proposals).toEqual([]);
    expect((await handleProposalReject(post("/api/proposals/nope/reject", {}), "nope", state)).status).toBe(404);

    const feed = harness.state().feed;
    expect(feed.map(({ tool, outcome }) => [tool, outcome])).toEqual([
      ["get_proposal", "→ 1 accepted, 1 pending"],
      ["edit_dashboard", "proposed 2 changes; filters applied"],
    ]);
    expect(feed[1]).toMatchObject({ agent: "omp", summary: "Add Count (+2 more)", write: true });
  });

  test("a change that no longer applies turns invalid while the others commit", async () => {
    const { workspace, harness } = await connect("omp");
    const proposed = await call("edit_dashboard", {
      ops: [
        { op: "add", type: "count", id: "c" },
        { op: "set_data", name: "big", source: { sql: "area > 40" } },
      ],
    });
    const id = proposed.body.id as string;
    // Meanwhile a direct edit takes the id the proposal wanted.
    harness.setMode("direct");
    expect(
      (await call("edit_dashboard", { ops: [{ op: "add", type: "text", id: "c", props: { text: "x" } }] })).body,
    ).toMatchObject({ revision: 1 });
    harness.setMode("propose");
    const result = await harness.accept(id);
    expect(result!.revision).toBe(2);
    expect(result!.proposal.changes).toMatchObject([
      { status: "invalid", reason: 'element id "c" is taken' },
      { status: "accepted" },
    ]);
    expect((workspace.get().document as any).data.big).toEqual({ sql: "area > 40" });
  });

  test("an invalid batch is refused at once with a rejected event and a feed entry", async () => {
    const { harness } = await connect("omp");
    const events: HarnessEvent[] = [];
    const dispose = harness.watch((event) => events.push(event));
    const refused = await call("edit_dashboard", { ops: [{ op: "add", type: "nope" }] });
    dispose();
    expect(refused.isError).toBe(true);
    expect(refused.body.issues[0].pointer).toBe("/ops/0");
    expect(events.filter((event) => event.kind === "rejected")).toMatchObject([
      { agent: "omp", reason: "edit rejected; nothing was applied", issues: [{ pointer: "/ops/0" }] },
    ]);
    expect(harness.state().proposals).toEqual([]);
    expect(harness.state().feed[0].outcome).toStartWith("rejected: edit rejected");
  });

  test("patch_workspace and restore_revision wait for Apply directly, which also applies edits at once", async () => {
    const { workspace, harness } = await connect("omp");
    const patch = await call("patch_workspace", { revision: 0, ops: [{ op: "add", path: "/data/a", value: {} }] });
    expect(patch).toMatchObject({ isError: true, body: { error: expect.stringContaining("Apply directly") } });
    expect((await call("restore_revision", { revision: 1 })).body.error).toContain("use edit_dashboard");
    expect(workspace.get().revision).toBe(0);

    const switched = await handleHarnessMode(
      new Request("http://localhost/api/harness/mode", { method: "PUT", body: JSON.stringify({ mode: "direct" }) }),
      { harness },
    );
    expect(await switched.json()).toMatchObject({ mode: "direct" });
    expect(await handleHarnessGet({ harness }).json()).toMatchObject({ mode: "direct", proposals: [] });
    expect(
      (await call("patch_workspace", { revision: 0, ops: [{ op: "add", path: "/data/a", value: {} }] })).body,
    ).toEqual({ revision: 1 });
    const applied = await call("edit_dashboard", { ops: [{ op: "add", type: "count" }] });
    expect(applied.body).toMatchObject({ revision: 2, changed: true, added: ["count-1"] });
  });
});
