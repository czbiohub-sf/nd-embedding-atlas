import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMcpEndpoint } from "../mcp.ts";
import { createServerSession, type DatasetMountConfig } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";
import { WorkspaceHistorySchema } from "@ndea/protocol";

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
  return { client, endpoint, workspace: state.workspace };
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
    const { workspace } = await connect();
    const tools = (await client!.listTools()).tools.map((tool) => tool.name).toSorted();
    expect(tools).toEqual([
      "create_observation_set",
      "edit_dashboard",
      "get_history",
      "get_result",
      "get_workspace",
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

    expect((await call("create_observation_set", { element: "count-1" })).body.count).toBe(1);
  });

  test("invalid edits are refused whole, with a pointer to fix, and change nothing", async () => {
    const { workspace } = await connect();
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
    expect(badProp.body.issues[0].pointer).toBe("/spec/elements/histogram-1/props/bins");

    const incapable = await call("edit_dashboard", {
      ops: [
        { op: "add", type: "text", props: { text: "hi" } },
        { op: "bind", id: "text-1", type: "filter", scope: "A" },
      ],
    });
    expect(incapable.body.issues[0].pointer).toBe("/spec/elements/text-1/props/filter");

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
    const { workspace } = await connect("omp");
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
    const { workspace } = await connect("not an agent!");
    await call("edit_dashboard", { ops: [{ op: "set_data", name: "a", source: { sql: "area > 20" } }] });
    expect(workspace.history()[0].actor).toEqual({ kind: "mcp" });
  });
});
