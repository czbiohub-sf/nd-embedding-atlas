import { afterEach, describe, expect, test } from "bun:test";
import type { DuckDBConnection } from "@duckdb/node-api";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMcpEndpoint } from "../mcp.ts";
import { createServerSession, type DatasetMountConfig } from "../state.ts";
import { DatasetQuerySession } from "../store.ts";
import { WorkspaceDocumentStore } from "../workspace.ts";

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

async function connect() {
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
  const workspace = WorkspaceDocumentStore.empty(join(dir, "workspace.json"));
  const state = createServerSession({
    store,
    workspace,
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
      return endpoint(request);
    },
  });
  client = new Client({ name: "test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  await client.connect(transport);
  return { client, endpoint, workspace };
}

async function call(name: string, args: Record<string, unknown>) {
  const result = await client!.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? "{}";
  return { isError: result.isError === true, body: JSON.parse(text) as Record<string, any> };
}

describe("ndea MCP", () => {
  test("refuses a missing token and a foreign Origin before any MCP handling", async () => {
    const { endpoint } = await connect();
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = {
      host: "localhost:5055",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };

    const anonymous = await endpoint(new Request("http://localhost:5055/mcp", { method: "POST", headers, body }));
    expect(anonymous.status).toBe(401);
    const foreign = await endpoint(
      new Request("http://localhost:5055/mcp", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.example", authorization: `Bearer ${TOKEN}` },
        body,
      }),
    );
    expect(foreign.status).toBe(403);
  });

  test("an agent builds a filtered, linked dashboard and reads the same numbers back", async () => {
    const { workspace } = await connect();
    const tools = (await client!.listTools()).tools.map((tool) => tool.name).toSorted();
    expect(tools).toEqual([
      "create_observation_set",
      "edit_dashboard",
      "get_result",
      "get_workspace",
      "list_columns",
      "list_components",
      "patch_workspace",
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
    expect(read.revision).toBe(workspace.snapshot().revision);
    expect(read.document.state.filter.A).toEqual({ agent: { area: { op: "gt", column: "area", value: 40 } } });

    expect((await call("create_observation_set", { element: "count-1" })).body.count).toBe(1);
  });

  test("invalid edits are refused whole, with a pointer to fix, and change nothing", async () => {
    const { workspace } = await connect();
    const before = workspace.snapshot().revision;

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

    expect(workspace.snapshot().revision).toBe(before);
  });
});
