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
import { filterClauseSql } from "@ndea/nodes/filter";
import { FilterClauseSchema, JsonPatchOpSchema, OBSERVATION_SET_TABLE, type JsonPatchOp } from "@ndea/protocol";
import { createPatch } from "rfc6902";
import { z } from "zod";

import { bindingScope, COORDINATION_TYPE_IDS, COORDINATION_TYPES } from "../frontend/core/coordination/types.ts";
import { stageViews } from "../frontend/core/workspace/stage/stage-spec.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import { SERVER_NODE_RESOLVER, type ServerNodeDefinition } from "./graph.ts";
import { applyWorkspacePatch, workspaceNodeResult } from "./routes/workspace.ts";
import type { ServerSession } from "./state.ts";
import { obsmColumnPrefix, quoteIdent } from "./store.ts";
import {
  applyWorkspaceEdits,
  GraphEditSchema,
  NOT_ADDABLE,
  ViewEditSchema,
  WorkspaceEditError,
  type GraphEdit,
  type ViewEdit,
} from "./workspace-edits.ts";

const INSTRUCTIONS = `ndea is a linked-views workspace over single-cell and imaging observations (one row per observation).
The workspace is one document: a data-flow graph of nodes (sources, filters, views) joined by predicate wires, a Stage layout of visible views, and coordination scopes that link views (shared filter, focus row, color column).
Start with get_workspace and list_columns. Change the data flow with edit_graph and the views with edit_view; both apply a whole batch atomically or not at all.
Every edit is validated like a user edit. A rejected call returns issues with JSON Pointer paths: fix the named op and retry.
Read results with get_node_result. The open browser tab shows every accepted change live.`;

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

function summarize(revision: number, doc: WorkspaceDocument): Record<string, unknown> {
  const edges = Object.values(doc.edges);
  const scopes = new Map<string, { type: string; scope: string; members: string[]; value: unknown }>();
  for (const [node, byType] of Object.entries(doc.bindings)) {
    for (const type of COORDINATION_TYPE_IDS) {
      const scope = bindingScope(type, byType[type]);
      if (scope === undefined) continue;
      const key = `${type}/${scope}`;
      const entry = scopes.get(key) ?? { type, scope, members: [], value: doc.state[type]?.[scope] ?? null };
      entry.members.push(node);
      scopes.set(key, entry);
    }
  }
  return {
    revision,
    nodes: Object.values(doc.nodes).map((node) => ({
      id: node.id,
      type: node.definitionRef.nodeTypeId,
      label: node.label,
      ...(node.parent ? { parent: node.parent } : {}),
      ...(node.config ? { config: node.config.value } : {}),
      inputs: edges.filter((edge) => edge.to === node.id).map((edge) => edge.from),
    })),
    stage: [...stageViews(doc.stage).keys()],
    scopes: [...scopes.values()],
  };
}

/**
 * Compile named edits against the current document and apply them as one
 * patch. Without an expected revision, a concurrent write is retried once
 * against the newer document, since named edits address ids, not positions.
 */
async function runEdits(
  state: ServerSession,
  edits: readonly (GraphEdit | ViewEdit)[],
  expected: number | undefined,
): Promise<ToolResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { revision, document: base } = document(state);
    if (expected !== undefined && expected !== revision) {
      return rejected("stale revision: the workspace changed; re-read it with get_workspace", { revision });
    }
    let next: WorkspaceDocument;
    try {
      next = applyWorkspaceEdits(base, edits, SERVER_NODE_RESOLVER);
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
      const added = Object.keys(next.nodes).filter((id) => !base.nodes[id]);
      return ok({ revision: result.revision, changed: true, ...(added.length > 0 ? { addedNodes: added } : {}) });
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

function describeType(definition: ServerNodeDefinition): Record<string, unknown> {
  return {
    type: definition.ref.nodeTypeId,
    title: definition.title,
    role: definition.role,
    summary: definition.documentation?.summary ?? "",
    inputs: definition.inputs.map((port) => port.id),
    outputs: definition.outputs.map((port) => port.id),
    links: COORDINATION_TYPE_IDS.filter((id) => definition.capabilities.includes(COORDINATION_TYPES[id].capability)),
    configurable: definition.config !== undefined,
    addable: !NOT_ADDABLE.has(definition.ref.nodeTypeId),
  };
}

export function createNdeaMcpServer(state: ServerSession): McpServer {
  const server = new McpServer({ name: "ndea", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_workspace",
    {
      title: "Read the workspace",
      description:
        "Read the workspace at its current revision. `summary` (default) lists every node with its type, label, config, and input node ids, the node ids shown on the Stage, and every coordination scope with its members and value. `full` returns the raw document, including canvas positions and the Stage layout tree.",
      inputSchema: z.object({ detail: z.enum(["summary", "full"]).default("summary") }),
      annotations: READ,
    },
    async ({ detail }) => {
      const { revision, document: doc } = document(state);
      return ok(detail === "full" ? { revision, document: doc } : summarize(revision, doc));
    },
  );

  server.registerTool(
    "list_node_types",
    {
      title: "List node types",
      description:
        "List the node types edit_graph can add: role (source, transform, view), ports, the coordination types each can link to, and a one-line summary. Pass `type` for one type's full documentation, its config JSON Schema, and its default config.",
      inputSchema: z.object({ type: z.string().optional() }),
      annotations: READ,
    },
    async ({ type }) => {
      const definitions = SERVER_NODE_RESOLVER.definitions;
      if (type === undefined) return ok({ types: definitions.map(describeType) });
      const definition = definitions.find((candidate) => candidate.ref.nodeTypeId === type);
      if (!definition)
        return rejected(`unknown node type "${type}"`, { types: definitions.map((d) => d.ref.nodeTypeId) });
      let schema: unknown = null;
      if (definition.config) {
        try {
          schema = z.toJSONSchema(definition.config.schema, { unrepresentable: "any" });
        } catch {
          schema = null;
        }
      }
      return ok({
        ...describeType(definition),
        use: definition.documentation?.use ?? "",
        ...(definition.documentation?.note ? { note: definition.documentation.note } : {}),
        ...(definition.config ? { config: { default: definition.config.defaultValue, schema } } : {}),
      });
    },
  );

  server.registerTool(
    "list_columns",
    {
      title: "List observation columns",
      description:
        "List the observation columns filters and views can use, with their SQL types. Pass `column` to profile one column: distinct count, nulls, min and max, and its most frequent values with counts (for categorical or low-cardinality columns).",
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

  server.registerTool(
    "get_node_result",
    {
      title: "Read a node's result",
      description:
        "Evaluate one node at the current revision: the SQL predicate it passes on or displays (including its filter scope), the scope part alone, the exact count of matching observations, and the first `limit` rows as {rowIndex, datasetKey, obsName}.",
      inputSchema: z.object({ node: z.string(), limit: z.number().int().min(0).max(500).default(20) }),
      annotations: READ,
    },
    async ({ node, limit }) => {
      const result = await workspaceNodeResult(state, node, limit);
      if (!result) return rejected(`no node "${node}"; get_workspace lists node ids`);
      if (result.status !== "resolved") return rejected(result.error ?? `node "${node}" is ${result.status}`, result);
      return ok(result);
    },
  );

  server.registerTool(
    "edit_graph",
    {
      title: "Edit the data flow",
      description:
        "Change the data-flow graph with a batch of ops, applied atomically: add_node (optionally wired from `inputs` and auto-placed), remove_node, connect, disconnect, set_config (merges into the node's config and validates it), rename. Use list_node_types for types and config fields, and list_columns for column names. Filters take typed clauses, e.g. {op:'eq', column:'predicted_infection_state', value:'infected'}. Pass `revision` to apply only if nothing changed since you read it. Returns the new revision and the ids of added nodes.",
      inputSchema: z.object({
        revision: RevisionSchema.optional(),
        ops: z.array(GraphEditSchema).min(1).max(100),
      }),
      annotations: WRITE,
    },
    async ({ revision, ops }) => runEdits(state, ops, revision),
  );

  server.registerTool(
    "edit_view",
    {
      title: "Edit the views",
      description:
        "Change what is shown and how views are linked, with a batch of ops applied atomically: show / hide a node on the Stage; link / unlink a node to a coordination scope (focus, filter, colorBy, viewSync, ordering; a new scope name creates it); set_value for a focus row, color column, sort, or view sync; set_filter to put your own crossfilter clause on a filter scope under a `source` key (every member sees it; null removes it). Pass `revision` to apply only if nothing changed since you read it.",
      inputSchema: z.object({
        revision: RevisionSchema.optional(),
        ops: z.array(ViewEditSchema).min(1).max(100),
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
        "Escape hatch for edits the named ops do not cover: apply RFC 6902 JSON Patch ops to the document (get_workspace detail:'full') at an exact revision. The patch is validated like any edit and applies atomically.",
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
      description: `Save a fixed set of observations: the current rows of a node (\`node\`) or of a typed clause (\`where\`). Returns a set id usable as {op:'inSet', set:<id>} in any filter clause, or to pin a Cache node with edit_graph set_config {pin:{clause:{op:'inSet', set}, count}}. Sets live in the ${OBSERVATION_SET_TABLE} table and survive restarts.`,
      inputSchema: z
        .object({ node: z.string().optional(), where: FilterClauseSchema.optional() })
        .refine((input) => (input.node === undefined) !== (input.where === undefined), {
          message: "pass exactly one of `node` or `where`",
        }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ node, where }) => {
      let predicate: string | null;
      if (node !== undefined) {
        const result = await workspaceNodeResult(state, node, 0);
        if (!result) return rejected(`no node "${node}"; get_workspace lists node ids`);
        if (result.status !== "resolved" || !result.output)
          return rejected(result.error ?? `node "${node}" did not resolve`);
        predicate = result.output.sql;
      } else {
        predicate = filterClauseSql(where!);
      }
      const rows = await state.store.querySingleJson(
        `SELECT __row_index__ FROM dataset${predicate ? ` WHERE ${predicate}` : ""}`,
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
