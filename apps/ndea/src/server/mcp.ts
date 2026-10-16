/**
 * MCP over Streamable HTTP at /mcp. Tools close over the one server session,
 * so every agent reads and edits the same workspace document the browser
 * shows, through the same validated write path (`applyWorkspacePatch`).
 *
 * Access: localhost Host and Origin only (DNS rebinding), plus the bearer
 * token from `mcp-token.ts`.
 */

import { timingSafeEqual } from "node:crypto";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { filterClauseSql } from "@ndea/components/filter";
import { FilterClauseSchema, JsonPatchOpSchema, OBSERVATION_SET_TABLE, type JsonPatchOp } from "@ndea/protocol";
import { createPatch } from "rfc6902";
import { z } from "zod";

import { COMPONENTS } from "../frontend/core/workspace/dashboard.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import { applyWorkspacePatch, workspaceResult } from "./routes/workspace.ts";
import type { ServerSession } from "./state.ts";
import { obsmColumnPrefix, quoteIdent } from "./store.ts";
import { applyDashboardEdits, DashboardEditSchema, WorkspaceEditError, type DashboardEdit } from "./workspace-edits.ts";

const INSTRUCTIONS = `ndea is a dashboard over single-cell and imaging observations (one row per observation).
The workspace is one JSON document {data, spec, state}:
- data: named data sources {from?, where?, sql?}. A source narrows its \`from\` source (or every observation) by a typed clause (\`where\`, e.g. {op:'eq', column:'predicted_infection_state', value:'infected'}; {op:'inSet', set} for a saved set) and/or a SQL predicate (\`sql\`).
- spec: a json-render flat spec {root, elements}; each element is {type, props, children}. Layout: split (exactly two children), stack (any children), slot (an empty tile). Content: text, select, and views (scatter, table, count, histogram, vgplot, ...). Props are \`data\` (a data source name; omitted = every observation), \`title\`, coordination bindings, and the component's own config over its defaults (list_components).
- state: coordination cells state[type][scope] for focus, filter, colorBy, viewSync, ordering. An element joins a scope through a binding prop: props.filter = {"$bindState": "/filter/A"}.
A filter scope is a crossfilter: state.filter[scope] = {source: {facet: clause}}. Each member shows its data source AND every other source's clauses, never its own (an element's source key is its id). Write your own clauses with set_filter under your own source key (e.g. "agent").
\`count\` is the metric component: it shows how many observations its data source and filter scope select.
\`vgplot\` props are a Mosaic plot spec: \`entries\` is the plot's marks and interactors in order, \`attributes\` the other Plot options. Reserved params: marks read data {from:"$table", filterBy:"$scope"}, and an interactor publishes its brush into the filter scope with as:"$brush". Example histogram: entries [{mark:"rectY", data:{from:"$table", filterBy:"$scope"}, x:{bin:"area"}, y:{count:[]}}, {select:"intervalX", as:"$brush", field:"area"}].
Start with get_workspace, list_components, and list_columns. Change the dashboard with edit_dashboard (a batch applied atomically); patch_workspace applies raw JSON Patch. Every write is validated like a user edit: a rejected call returns issues with JSON Pointers (/ops/<i> names the op; /spec/elements/<id>/props/<key> names a bad prop): fix and retry.
Read numbers with get_result. The open browser tab shows every accepted change live.`;

/** The /mcp route: localhost-only Host and Origin, a matching bearer token, then the MCP handler. */
export function createMcpEndpoint(state: ServerSession, token: string): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(() => createNdeaMcpServer(state));
  const expected = Buffer.from(`Bearer ${token}`);
  return async (request) => {
    const forbidden =
      hostHeaderValidationResponse(request, localhostAllowedHostnames()) ??
      originValidationResponse(request, localhostAllowedOrigins());
    if (forbidden) return forbidden;
    const presented = Buffer.from(request.headers.get("authorization") ?? "");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      return new Response("missing or invalid bearer token (see ~/.ndea/mcp-token)", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }
    return handler.fetch(request);
  };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

function rejected(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }], isError: true };
}

function document(state: Pick<ServerSession, "workspace">): { revision: number; document: WorkspaceDocument } {
  // The store only holds documents that passed `parseWorkspaceDocument`.
  const snapshot = state.workspace.snapshot();
  return { revision: snapshot.revision, document: snapshot.document as WorkspaceDocument };
}

/**
 * Compile named edits against the current document and apply them as one
 * patch. Without an expected revision, a concurrent write is retried once
 * against the newer document, since named edits address ids, not positions.
 */
async function runEdits(
  state: ServerSession,
  edits: readonly DashboardEdit[],
  expected: number | undefined,
): Promise<ToolResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { revision, document: base } = document(state);
    if (expected !== undefined && expected !== revision) {
      return rejected("stale revision: the workspace changed; re-read it with get_workspace", { revision });
    }
    let next: WorkspaceDocument;
    try {
      next = applyDashboardEdits(base, edits);
    } catch (error) {
      if (!(error instanceof WorkspaceEditError)) throw error;
      return rejected("edit rejected; nothing was applied", {
        revision,
        issues: [{ pointer: `/ops/${error.index}`, detail: error.message }],
      });
    }
    const ops: JsonPatchOp[] = JsonPatchOpSchema.array().parse(createPatch(base, next));
    if (ops.length === 0) return ok({ revision, changed: false });
    const result = await applyWorkspacePatch(state, revision, ops, "mcp");
    if (result.kind === "accepted") {
      const added = Object.keys(next.spec.elements).filter((id) => !Object.hasOwn(base.spec.elements, id));
      return ok({ revision: result.revision, changed: true, ...(added.length > 0 ? { added } : {}) });
    }
    if (result.kind === "invalid") {
      return rejected("the edit would leave an invalid workspace; nothing was applied", {
        revision,
        issues: result.issues,
      });
    }
    if (expected !== undefined) break;
  }
  return rejected("stale revision: the workspace changed; re-read it with get_workspace", {
    revision: state.workspace.snapshot().revision,
  });
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;
const RevisionSchema = z.number().int().nonnegative();

function propsSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema, { unrepresentable: "any" });
  } catch {
    return null;
  }
}

export function createNdeaMcpServer(state: ServerSession): McpServer {
  const server = new McpServer({ name: "ndea", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_workspace",
    {
      title: "Read the workspace",
      description:
        "Read the workspace document at its current revision: `data` (named data sources), `spec` (the dashboard: {root, elements}, each element {type, props, children}), and `state` (coordination cells state[type][scope]; elements bind them with props like filter: {$bindState: '/filter/A'}).",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => ok(document(state)),
  );

  server.registerTool(
    "list_components",
    {
      title: "List dashboard components",
      description:
        "List every component an element can be: its description, children rule (two, any, none), whether it reads a data source (`reads`: takes `data` and `title` props), the coordination types it may bind, its default config, and the JSON Schema of its config props (merged over the defaults). `count` is the metric; `vgplot` takes a Mosaic plot spec {entries, attributes}.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () =>
      ok({
        components: Object.entries(COMPONENTS).map(([type, info]) => ({
          type,
          description: info.description,
          children: info.children,
          reads: info.reads,
          binds: info.binds,
          defaults: info.defaults,
          props: propsSchema(info.props),
        })),
      }),
  );

  server.registerTool(
    "list_columns",
    {
      title: "List observation columns",
      description:
        "List the observation columns data sources, clauses, and views can use, with their SQL types. Pass `column` to profile one column: distinct count, nulls, min and max, and its most frequent values with counts (for categorical or low-cardinality columns).",
      inputSchema: z.object({
        column: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(25).describe("most frequent values to return"),
      }),
      annotations: READ,
    },
    async ({ column, limit }) => {
      const prefixes = state.availableObsmKeys.map(obsmColumnPrefix);
      const described = await state.store.querySingleJson("SELECT column_name, column_type FROM (DESCRIBE dataset)");
      const columns = described
        .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }))
        .filter(({ name }) => !name.startsWith("__") && !prefixes.some((prefix) => name.startsWith(prefix)));
      if (column === undefined) return ok({ columns });
      const match = columns.find((candidate) => candidate.name === column);
      if (!match) return rejected(`unknown column "${column}"`, { columns: columns.map((c) => c.name) });
      const c = quoteIdent(match.name);
      const [stats] = await state.store.querySingleJson(
        `SELECT approx_count_distinct(${c}) AS distinct_values, count(*) - count(${c}) AS nulls, CAST(min(${c}) AS VARCHAR) AS min, CAST(max(${c}) AS VARCHAR) AS max FROM dataset`,
      );
      const categorical = /VARCHAR|BOOL|ENUM/.test(match.type) || Number(stats.distinct_values) <= 50;
      const values = categorical
        ? await state.store.querySingleJson(
            `SELECT ${c} AS value, count(*) AS count FROM dataset GROUP BY 1 ORDER BY count DESC LIMIT ${limit}`,
          )
        : undefined;
      return ok({ ...match, ...stats, ...(values ? { values } : {}) });
    },
  );

  const TargetSchema = z
    .object({
      element: z.string().optional().describe("a dashboard element id"),
      data: z.string().optional().describe("a data source name"),
    })
    .refine((input) => (input.element === undefined) !== (input.data === undefined), {
      message: "pass exactly one of `element` or `data`",
    });

  server.registerTool(
    "get_result",
    {
      title: "Read a result",
      description:
        "Evaluate at the current revision what one element shows (`element`: its data source AND the other sources' clauses in its filter scope) or what one data source selects (`data`). Returns the SQL predicate (null = every observation) and the exact count of matching observations.",
      inputSchema: TargetSchema,
      annotations: READ,
    },
    async ({ element, data }) => {
      const result = await workspaceResult(state, element !== undefined ? { element } : { data: data! });
      return result.status === 200 ? ok(result.body) : rejected(result.body.error, result.body);
    },
  );

  server.registerTool(
    "edit_dashboard",
    {
      title: "Edit the dashboard",
      description:
        "Change the workspace with a batch of ops, applied atomically. Data: set_data {name, source} adds or replaces a data source; remove_data {name}. Elements: add {type, id?, props?, at?} places a new element: at {slot} fills an empty slot, {stack, index?} inserts into a stack, {beside, side?: left|right|up|down} splits that element (default: fill an empty root slot, else split the root to its right); set_props {id, props} merges props (null removes a key); remove {id}; swap {a, b}. Coordination: bind {id, type, scope} sets the element's {$bindState} prop and creates the scope if needed; unbind {id, type} also drops the element's own filter clauses; set_filter {scope, source, facet, clause|null} writes your own crossfilter clause under your source key (every member sees it). Pass `revision` to apply only if nothing changed since you read it. Returns the new revision and the ids of added elements.",
      inputSchema: z.object({
        revision: RevisionSchema.optional(),
        ops: z.array(DashboardEditSchema).min(1).max(100),
      }),
      annotations: WRITE,
    },
    async ({ revision, ops }) => runEdits(state, ops, revision),
  );

  server.registerTool(
    "patch_workspace",
    {
      title: "Patch the workspace document",
      description:
        "Escape hatch for edits the named ops do not cover: apply RFC 6902 JSON Patch ops to the document (get_workspace) at an exact revision, e.g. replace /state/focus/A or /spec/elements/<id>/props/<key>. The patch is validated like any edit and applies atomically.",
      inputSchema: z.object({ revision: RevisionSchema, ops: z.array(JsonPatchOpSchema).min(1).max(1000) }),
      annotations: WRITE,
    },
    async ({ revision, ops }) => {
      const result = await applyWorkspacePatch(state, revision, ops, "mcp");
      if (result.kind === "accepted") return ok({ revision: result.revision });
      if (result.kind === "conflict") {
        return rejected("stale revision: re-read the document and rebuild the patch", {
          revision: result.snapshot.revision,
        });
      }
      return rejected("the patch would leave an invalid workspace; nothing was applied", { issues: result.issues });
    },
  );

  server.registerTool(
    "create_observation_set",
    {
      title: "Save observations as a set",
      description: `Save a fixed set of observations: what an element shows (\`element\`), what a data source selects (\`data\`), or a typed clause (\`where\`). Returns a set id usable as {op:'inSet', set:<id>} in any clause, e.g. a data source's \`where\` or a set_filter clause. Sets live in the ${OBSERVATION_SET_TABLE} table and survive restarts.`,
      inputSchema: z
        .object({ element: z.string().optional(), data: z.string().optional(), where: FilterClauseSchema.optional() })
        .refine((input) => [input.element, input.data, input.where].filter((v) => v !== undefined).length === 1, {
          message: "pass exactly one of `element`, `data`, or `where`",
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ element, data, where }) => {
      let predicate: string | null;
      if (where !== undefined) {
        predicate = filterClauseSql(where);
      } else {
        const result = await workspaceResult(state, element !== undefined ? { element } : { data: data! });
        if (result.status !== 200) return rejected(result.body.error, result.body);
        predicate = result.body.predicate;
      }
      const rows = await state.store.querySingleJson(
        `SELECT __row_index__ FROM dataset${predicate ? ` WHERE (${predicate})` : ""}`,
      );
      if (rows.length === 0) return rejected("no observations match; nothing was saved");
      try {
        const set = await state.observationSets.create(rows.map((row) => Number(row.__row_index__)));
        return ok({ ...set, clause: { op: "inSet", set: set.set } });
      } catch (error) {
        return rejected(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}
