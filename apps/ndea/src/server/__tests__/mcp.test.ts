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
const ref = (nodeTypeId: string) => ({ nodeTypeId, nodeTypeVersion: "1.0.0" });

const seed = {
  nodeAssets: [],
  nodes: {
    obs: { id: "obs", definitionRef: ref("obs"), label: "obs" },
    table: { id: "table", definitionRef: ref("table"), label: "Table" },
  },
  edges: { e1: { id: "e1", from: "obs", fromPort: "out", to: "table", toPort: "in", kind: "pred" } },
  positions: { obs: { x: 0, y: 0 }, table: { x: 320, y: 0 } },
  sizeOverrides: {},
  formOverride: {},
  formLocked: {},
  stage: null,
  stripH: 280,
  flags: {},
  state: {},
  bindings: {},
};

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
  await workspace.apply(0, [{ op: "add", path: "", value: seed }]);
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

  test("an agent builds a filtered, linked, staged view and reads the same numbers back", async () => {
    const { workspace } = await connect();
    const tools = (await client!.listTools()).tools.map((tool) => tool.name).toSorted();
    expect(tools).toEqual([
      "create_observation_set",
      "edit_graph",
      "edit_view",
      "get_node_result",
      "get_workspace",
      "list_columns",
      "list_node_types",
      "patch_workspace",
    ]);

    const column = await call("list_columns", { column: "condition" });
    expect(column.body.values).toEqual([
      { value: "infected", count: 2 },
      { value: "mock", count: 1 },
    ]);

    const graph = await call("edit_graph", {
      ops: [
        {
          op: "add_node",
          type: "filter",
          id: "infected",
          inputs: ["obs"],
          config: { where: { op: "eq", column: "condition", value: "infected" } },
        },
        { op: "add_node", type: "count", inputs: ["infected"] },
      ],
    });
    expect(graph.isError).toBe(false);
    expect(graph.body.addedNodes).toEqual(["infected", "count-1"]);
    expect((await call("get_node_result", { node: "count-1" })).body.output.count).toBe(2);

    const view = await call("edit_view", {
      revision: graph.body.revision,
      ops: [
        { op: "link", node: "table", type: "filter", scope: "A" },
        { op: "set_filter", scope: "A", source: "agent", where: { op: "gt", column: "area", value: 40 } },
        { op: "show", node: "table", title: "Large cells" },
      ],
    });
    expect(view.isError).toBe(false);
    expect((await call("get_node_result", { node: "table" })).body.output.count).toBe(2);

    const summary = (await call("get_workspace", {})).body;
    expect(summary.stage).toEqual(["table"]);
    expect(summary.scopes).toEqual([
      {
        type: "filter",
        scope: "A",
        members: ["table"],
        value: { agent: { where: { op: "gt", column: "area", value: 40 } } },
      },
    ]);
    expect(workspace.snapshot().revision).toBe(view.body.revision);

    const set = await call("create_observation_set", { node: "infected" });
    expect(set.body.count).toBe(2);
  });

  test("invalid edits are refused whole, with a pointer to fix, and change nothing", async () => {
    const { workspace } = await connect();
    const before = workspace.snapshot().revision;

    const badConfig = await call("edit_graph", {
      ops: [
        { op: "add_node", type: "filter", id: "f" },
        { op: "set_config", node: "f", config: { where: { op: "nope" } } },
      ],
    });
    expect(badConfig.isError).toBe(true);
    expect(badConfig.body.issues[0].pointer).toBe("/ops/1");

    const cycle = await call("edit_graph", {
      ops: [
        { op: "add_node", type: "filter", id: "f1", inputs: ["obs"] },
        { op: "add_node", type: "filter", id: "f2", inputs: ["f1"] },
        { op: "connect", from: "f2", to: "f1" },
      ],
    });
    expect(cycle.isError).toBe(true);
    expect(cycle.body.issues[0].pointer).toMatch(/^\/edges\//);

    const incapable = await call("edit_view", { ops: [{ op: "link", node: "obs", type: "filter", scope: "A" }] });
    expect(incapable.isError).toBe(true);

    const stale = await call("edit_view", { revision: before - 1, ops: [{ op: "show", node: "table" }] });
    expect(stale.body).toMatchObject({ revision: before });

    expect(workspace.snapshot().revision).toBe(before);
  });
});
