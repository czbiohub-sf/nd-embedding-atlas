/**
 * MCP over Streamable HTTP at /mcp. Tools close over the one server session,
 * so every agent reads and edits the same workspace document the browser
 * shows. Named edits go through the workspace's harness pipeline
 * (`Workspace.harness`): applied, or held as a proposal while Harness edits
 * are set to propose. Writes are stamped `mcp`, with the agent named by an
 * `X-Ndea-Agent` header that matches the actor pattern (provenance only; the
 * bearer token is the gate). Every tool call lands in the harness feed.
 *
 * Access: loopback Host and Origin only (DNS rebinding): localhost,
 * 127.0.0.1, [::1], or any `*.localhost` name (RFC 6761 loopback, the
 * portless dev URLs), plus the bearer token from `mcp-token.ts`.
 */

import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { filterClauseSql } from "@ndea/components/filter";
import {
  FilterClauseSchema,
  JsonPatchOpSchema,
  OBSERVATION_SET_TABLE,
  WorkspaceActorSchema,
  type WorkspaceActor,
} from "@ndea/protocol";
import { z } from "zod";

import { COMPONENTS } from "../frontend/core/workspace/dashboard.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import { hasBearer } from "./mcp-token.ts";
import { rowWords } from "./observation-sets.ts";
import { workspaceResult } from "./routes/workspace.ts";
import type { ServerSession } from "./state.ts";
import { agentSeen, clients } from "./status.ts";
import { quoteIdent } from "@ndea/protocol";
import {
  DashboardEditSchema,
  describeEdit,
  resolveEditReferences,
  resolveElementId,
  type DashboardEdit,
} from "../frontend/core/workspace/edits.ts";

const INSTRUCTIONS = `ndea is a dashboard over single-cell and imaging observations (one row per observation).
The workspace is one JSON document {data, layouts, layout, state}:
- data: named data sources {from?, where?, sql?}. A source narrows its \`from\` source (or every observation) by a typed clause (\`where\`, e.g. {op:'eq', column:'predicted_infection_state', value:'infected'}; {op:'inSet', set} for a saved set) and/or a SQL predicate (\`sql\`).
- layouts: named layouts {[id]: {name, spec}}; \`layout\` is the id of the one the person sees. Each spec is a json-render flat spec {root, elements}; each element is {type, props, children}. Element ids are unique across every layout. Layout components: split (exactly two children), stack (any children), tabs (a tile holding several views; \`active\` is the shown child's id), slot (an empty tile). A view leaf on its own is a one-tab tile. Content: text, select, and views (scatter, table, count, histogram, vgplot, ...). Props are \`data\` (a data source name; omitted = every observation), \`title\`, coordination bindings, and the component's own config over its defaults (list_components).
- state: coordination cells state[type][scope] for focus, filter, colorBy, viewSync, ordering, shared by every layout. An element joins a scope through a binding prop: props.filter = {"$bindState": "/filter/A"}.
A filter scope is a crossfilter: state.filter[scope] = {source: {facet: clause}}. Each member shows its data source AND every other source's clauses, never its own (an element's source key is its id). Write your own clauses with set_filter under your own source key (e.g. "agent").
\`count\` is the metric component: it shows how many observations its data source and filter scope select.
\`vgplot\` props are a Mosaic plot spec: \`entries\` is the plot's marks and interactors in order, \`attributes\` the other Plot options. Reserved params: marks read data {from:"$table", filterBy:"$scope"}, and an interactor publishes its brush into the filter scope with as:"$brush". Example histogram: entries [{mark:"rectY", data:{from:"$table", filterBy:"$scope"}, x:{bin:"area"}, y:{count:[]}}, {select:"intervalX", as:"$brush", field:"area"}].
Start with get_workspace, list_components, and list_columns; list_collections names the project's collections and the open one. Change the dashboard with edit_dashboard (a batch, validated whole); patch_workspace applies raw JSON Patch. Every write is validated like a user edit: a rejected call returns issues with JSON Pointers (/ops/<i> names the op; /layouts/<layout>/spec/elements/<id>/props/<key> names a bad prop): fix and retry.
The person reviews harness edits. While Harness edits are set to propose (the default), edit_dashboard returns {status:"proposed", id, changes}: each change waits as a proposal the person accepts or rejects in the app, and get_proposal {id} reports each change's status (pending, accepted, rejected, or invalid with a reason when it no longer applied). set_filter ops still apply directly: filters are exploration state. patch_workspace and restore_revision work only when the person switches Harness edits to Apply directly; then edit_dashboard applies at once too.
Read numbers with get_result. The open browser tab shows every accepted change live.
get_history lists recent revisions (who wrote each, and its ops); restore_revision brings an earlier revision back as a new one.`;

/** True when `url` parses to a loopback hostname: localhost, 127.0.0.1, [::1], or `*.localhost`. */
function isLoopbackUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return ["localhost", "127.0.0.1", "[::1]"].includes(hostname) || hostname.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The MCP actor for a request: `X-Ndea-Agent` names the agent when it is well formed. */
function mcpActor(headers: Headers | undefined): WorkspaceActor {
  const actor = WorkspaceActorSchema.safeParse({ kind: "mcp", agent: headers?.get("x-ndea-agent") ?? undefined });
  return actor.success ? actor.data : { kind: "mcp" };
}

/** The /mcp route: loopback-only Host and Origin, a matching bearer token, then the MCP handler. */
export function createMcpEndpoint(state: ServerSession, token: string): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(({ requestInfo }) => createNdeaMcpServer(state, mcpActor(requestInfo?.headers)));
  return async (request) => {
    // A missing Origin passes: only browsers send one, and that is what DNS rebinding abuses.
    const origin = request.headers.get("origin");
    if (!isLoopbackUrl(`http://${request.headers.get("host")}`) || (origin && !isLoopbackUrl(origin))) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32000, message: "Host and Origin must be loopback" }, id: null },
        { status: 403 },
      );
    }
    if (!hasBearer(request, token)) {
      return new Response("missing or invalid bearer token (see ~/.ndea/mcp-token)", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }
    const { agent } = mcpActor(request.headers);
    if (agent) agentSeen(agent);
    clients.mcpInFlight++;
    try {
      return await handler.fetch(request);
    } finally {
      clients.mcpInFlight--;
    }
  };
}

/** `outcome`: the harness feed's few words for this call; stripped before the result goes out. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  outcome: string;
};

function ok(data: Record<string, unknown>, outcome = "ok"): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, outcome };
}

function rejected(error: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, ...extra }) }],
    isError: true,
    outcome: `rejected: ${error}`,
  };
}

function document(state: Pick<ServerSession, "workspace">): { revision: number; document: WorkspaceDocument } {
  // The workspace only holds documents that passed `parseWorkspaceDocument`.
  const snapshot = state.workspace.get();
  return { revision: snapshot.revision, document: snapshot.document as WorkspaceDocument };
}

/** An `element` (id or reference) or `data` target; a reference into another workspace is an error. */
function elementTarget(
  state: Pick<ServerSession, "workspace">,
  element: string | undefined,
  data: string,
): { element: string } | { data: string } | { error: string } {
  if (element === undefined) return { data };
  try {
    return { element: resolveElementId(element, state.workspace.name) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The op list in a few glossary words for the harness feed, e.g. `Add Histogram beside Table (+2 more)`. */
function describeOps(state: Pick<ServerSession, "workspace">, ops: readonly DashboardEdit[]): string {
  let resolved = ops;
  try {
    resolved = resolveEditReferences(ops, state.workspace.name);
  } catch {
    // Unresolvable references describe as written; the edit itself reports the error.
  }
  const first = describeEdit(resolved[0], document(state).document);
  return resolved.length > 1 ? `${first} (+${resolved.length - 1} more)` : first;
}

const PROPOSE_ONLY =
  "the person reviews harness edits; use edit_dashboard, or ask them to switch Harness edits to Apply directly";

function plural(count: number, noun: string): string {
  return `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;
}

const EDIT_DASHBOARD =
  "Change the workspace with a batch of ops, validated whole: while Harness edits are set to propose (the default) it returns {status:'proposed', id, changes:[{index, summary}]} and each change waits for the person to accept or reject it (read the outcome with get_proposal); set_filter ops still apply directly. When they are set to Apply directly, the batch applies atomically and returns the new revision and the ids of added elements. Data: set_data {name, source} adds or replaces a data source; remove_data {name}. Layouts: add_layout {id?, name, from?} adds a named layout (`from` duplicates that layout with fresh element ids; omitted: one empty tile) without showing it; rename_layout {id, name}; remove_layout {id} (never the last); set_active_layout {id} shows it. Elements (each op finds the layout holding its element): add {type, id?, props?, at?, layout?} places a new element in `layout` (default: the layout holding `at`, else the active one): at {slot} fills an empty slot, {stack, index?} inserts into a stack, {beside, side?: left|right|up|down} splits that element's tile (default: fill an empty root slot, else split the root to its right); set_props {id, props} merges props (null removes a key); remove {id}; swap {a, b}. Tabs: add_tab {tile, type, props?, id?} adds a view as the tile's active tab (a bare view tile is wrapped in tabs; an empty tile is filled); move_tab {id, to, index?} moves a view into another tile of the same layout (a tabs tile, one of its tabs, a bare view, or an empty tile) as its active tab; close_tab {id} removes a view from its tile (the last tab leaves an empty tile); set_active_tab {tile, id} shows a tab. Coordination: bind {id, type, scope} sets the element's {$bindState} prop and creates the link (scope) if needed; unbind {id, type} also drops the element's own filter clauses; set_filter {scope, source, facet, clause|null} writes your own crossfilter clause under your source key (every member sees it). Any existing element id may be a view's copied reference ndea://<workspace>/<id>. Pass `revision` to apply (or propose) only if nothing changed since you read it.";

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

export function createNdeaMcpServer(state: ServerSession, actor: WorkspaceActor): McpServer {
  const server = new McpServer({ name: "ndea", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const { harness } = state.workspace;

  /** Register a tool whose every call lands in the harness feed: `summary` the args, the result's `outcome`. */
  function register<S extends z.ZodType<Record<string, unknown>>>(
    name: string,
    config: { title: string; description: string; inputSchema: S; annotations: ToolAnnotations },
    summary: (args: z.output<S>) => string,
    run: (args: z.output<S>) => Promise<ToolResult>,
  ): void {
    const input: StandardSchemaWithJSON = config.inputSchema;
    // The SDK validates `args` against `inputSchema` before this runs.
    server.registerTool(name, { ...config, inputSchema: input }, async (raw: unknown) => {
      const args = raw as z.output<S>;
      const call = {
        agent: actor.agent ?? null,
        tool: name,
        summary: summary(args),
        write: config.annotations === WRITE,
      };
      try {
        const { outcome, ...result } = await run(args);
        harness.record({ ...call, outcome });
        return result;
      } catch (error) {
        harness.record({ ...call, outcome: `rejected: ${error instanceof Error ? error.message : String(error)}` });
        throw error;
      }
    });
  }

  register(
    "get_workspace",
    {
      title: "Read the workspace",
      description:
        "Read the workspace document at its current revision: `data` (named data sources), `layouts` (named layouts {[id]: {name, spec}}, each spec {root, elements} with elements {type, props, children}; element ids are unique across layouts), `layout` (the id of the layout the person sees), and `state` (coordination cells state[type][scope] every layout shares; elements bind them with props like filter: {$bindState: '/filter/A'}).",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () => "workspace",
    async () => {
      const read = document(state);
      return ok(read, `→ revision ${read.revision}`);
    },
  );

  register(
    "list_components",
    {
      title: "List dashboard components",
      description:
        "List every component an element can be: its description, children rule (two, any, none), whether it reads a data source (`reads`: takes `data` and `title` props), the coordination types it may bind, its default config, and the JSON Schema of its config props (merged over the defaults). `count` is the metric; `vgplot` takes a Mosaic plot spec {entries, attributes}.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () => "components",
    async () =>
      ok(
        {
          components: Object.entries(COMPONENTS).map(([type, info]) => ({
            type,
            description: info.description,
            children: info.children,
            reads: info.reads,
            binds: info.binds,
            defaults: info.defaults,
            props: propsSchema(info.props),
          })),
        },
        `→ ${plural(Object.keys(COMPONENTS).length, "component")}`,
      ),
  );

  register(
    "list_columns",
    {
      title: "List observation columns",
      description:
        "List the observation columns data sources, clauses, and views can use, with their SQL types and kind (obs, var, annotation). Pass `column` to profile one column: distinct count, nulls, min and max, and its most frequent values with counts (for categorical or low-cardinality columns).",
      inputSchema: z.object({
        column: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(25).describe("most frequent values to return"),
      }),
      annotations: READ,
    },
    ({ column }) => column ?? "all columns",
    async ({ column, limit }) => {
      const columns = [...state.store.columns()]
        .filter(([name]) => !name.startsWith("__"))
        .map(([name, { sqlType, kind }]) => ({ name, type: sqlType, kind }));
      if (column === undefined) return ok({ columns }, `→ ${plural(columns.length, "column")}`);
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
      return ok(
        { ...match, ...stats, ...(values ? { values } : {}) },
        `→ ${plural(Number(stats.distinct_values), "distinct value")}`,
      );
    },
  );

  register(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the project's collections (each a group of datasets with their obs counts) and the open one. Only the open collection's datasets are loaded; inside it, one dataset is a filter clause on `_dataset`. Switching collection re-loads the data and happens in the browser (Data panel or ⌘K), not here.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () => "collections",
    async () =>
      ok(
        { collection: state.status.collection, collections: state.status.collections },
        `→ ${plural(state.status.collections.length, "collection")}`,
      ),
  );

  const TargetSchema = z
    .object({
      element: z.string().optional().describe("an element id or its reference ndea://<workspace>/<id>"),
      data: z.string().optional().describe("a data source name"),
    })
    .refine((input) => (input.element === undefined) !== (input.data === undefined), {
      message: "pass exactly one of `element` or `data`",
    });

  register(
    "get_result",
    {
      title: "Read a result",
      description:
        "Evaluate at the current revision what one element shows (`element`: its data source AND the other sources' clauses in its filter scope) or what one data source selects (`data`). `element` takes an id or a view's copied reference (ndea://<workspace>/<id>). Returns the SQL predicate (null = every observation) and the exact count of matching observations.",
      inputSchema: TargetSchema,
      annotations: READ,
    },
    ({ element, data }) => element ?? `source "${data}"`,
    async ({ element, data }) => {
      const target = elementTarget(state, element, data!);
      if ("error" in target) return rejected(target.error);
      const result = await workspaceResult(state, target);
      return result.status === 200
        ? ok(result.body, `→ ${result.body.count.toLocaleString("en-US")} obs`)
        : rejected(result.body.error, result.body);
    },
  );

  register(
    "edit_dashboard",
    {
      title: "Edit the dashboard",
      description: EDIT_DASHBOARD,
      inputSchema: z.object({
        revision: RevisionSchema.optional(),
        ops: z.array(DashboardEditSchema).min(1).max(100),
      }),
      annotations: WRITE,
    },
    ({ ops }) => describeOps(state, ops),
    async ({ revision, ops }) => {
      const result = await harness.edit(ops, actor, revision);
      switch (result.kind) {
        case "applied":
          return ok(
            {
              revision: result.revision,
              changed: result.changed,
              ...(result.added.length > 0 ? { added: result.added } : {}),
            },
            result.changed ? "applied" : "no change",
          );
        case "proposed":
          return ok(
            {
              status: "proposed",
              id: result.proposal.id,
              changes: result.proposal.changes.map(({ index, summary }) => ({ index, summary })),
              note: "each change waits for the person to accept or reject it in the app; get_proposal reports the outcome",
              ...(result.filters
                ? { filters: { ...result.filters, note: "set_filter ops applied directly, without review" } }
                : {}),
            },
            `proposed ${plural(result.proposal.changes.length, "change")}${result.filters ? "; filters applied" : ""}`,
          );
        case "invalid":
          return rejected(result.reason, { revision: result.revision, issues: result.issues });
        case "stale":
          return rejected("stale revision: the workspace changed; re-read it with get_workspace", {
            revision: result.revision,
          });
      }
    },
  );

  register(
    "get_proposal",
    {
      title: "Read a proposal",
      description:
        "Read a proposal edit_dashboard returned: each change's index, summary, op, and status: pending (the person has not decided), accepted (committed), rejected (the person declined it), or invalid (it no longer applied to the current workspace when accepted; `reason` says why). Proposals live in server memory: a restart drops them.",
      inputSchema: z.object({ id: z.string() }),
      annotations: READ,
    },
    ({ id }) => `proposal ${id.slice(0, 8)}`,
    async ({ id }) => {
      const proposal = harness.proposal(id);
      if (!proposal) return rejected(`unknown proposal "${id}" (a restart drops proposals)`);
      const counts = Map.groupBy(proposal.changes, (change) => change.status);
      return ok(proposal, `→ ${[...counts].map(([status, changes]) => `${changes.length} ${status}`).join(", ")}`);
    },
  );

  register(
    "patch_workspace",
    {
      title: "Patch the workspace document",
      description:
        "Escape hatch for edits the named ops do not cover: apply RFC 6902 JSON Patch ops to the document (get_workspace) at an exact revision, e.g. replace /state/focus/A or /layouts/<layout>/spec/elements/<id>/props/<key>. The patch is validated like any edit and applies atomically.",
      inputSchema: z.object({ revision: RevisionSchema, ops: z.array(JsonPatchOpSchema).min(1).max(1000) }),
      annotations: WRITE,
    },
    ({ ops }) => plural(ops.length, "JSON Patch op"),
    async ({ revision, ops }) => {
      if (harness.proposing) return rejected(PROPOSE_ONLY);
      const result = await state.workspace.patch(ops, { base: revision, actor });
      if (result.kind === "accepted") return ok({ revision: result.revision }, "applied");
      if (result.kind === "conflict") {
        return rejected("stale revision: re-read the document and rebuild the patch", {
          revision: result.snapshot.revision,
        });
      }
      const reason = "the patch would leave an invalid workspace; nothing was applied";
      harness.rejected(actor, reason, result.issues);
      return rejected(reason, { issues: result.issues });
    },
  );

  register(
    "get_history",
    {
      title: "Read the revision history",
      description:
        "List recent workspace revisions, newest first: each one's number, base revision, who committed it (actor kind system, browser, cli, or mcp, plus the agent name), its JSON Patch ops, commit time, and `restoredFrom` when it restored an earlier revision.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(20) }),
      annotations: READ,
    },
    ({ limit }) => `last ${limit}`,
    async ({ limit }) => {
      const revisions = state.workspace.history({ limit });
      return ok({ revisions }, `→ ${plural(revisions.length, "revision")}`);
    },
  );

  register(
    "restore_revision",
    {
      title: "Restore an earlier revision",
      description:
        "Bring the document at an earlier `revision` (see get_history) back as a new revision; history keeps everything in between. Pass `revision_base` to apply only if the workspace is still at that revision. Validated like any edit.",
      inputSchema: z.object({ revision: z.number().int().positive(), revision_base: RevisionSchema.optional() }),
      annotations: WRITE,
    },
    ({ revision }) => `revision ${revision}`,
    async ({ revision, revision_base }) => {
      if (harness.proposing) return rejected(PROPOSE_ONLY);
      const base = revision_base ?? state.workspace.get().revision;
      const result = await state.workspace.restore(revision, { base, actor });
      if (result.kind === "accepted") return ok({ revision: result.revision, restoredFrom: revision }, "applied");
      if (result.kind === "not-found") return rejected(`unknown revision ${revision}; list them with get_history`);
      if (result.kind === "conflict") {
        return rejected("stale revision: the workspace changed; re-read it with get_workspace", {
          revision: result.snapshot.revision,
        });
      }
      const reason = "restoring would leave an invalid workspace; nothing was applied";
      harness.rejected(actor, reason, result.issues);
      return rejected(reason, { issues: result.issues });
    },
  );

  register(
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
    ({ element, data, where }) => element ?? (data !== undefined ? `source "${data}"` : `clause ${where?.op}`),
    async ({ element, data, where }) => {
      let predicate: string | null;
      if (where !== undefined) {
        predicate = filterClauseSql(where);
      } else {
        const target = elementTarget(state, element, data!);
        if ("error" in target) return rejected(target.error);
        const result = await workspaceResult(state, target);
        if (result.status !== 200) return rejected(result.body.error, result.body);
        predicate = result.body.predicate;
      }
      const rows = await state.store.querySingleJson(
        `SELECT __row_index__ FROM dataset${predicate ? ` WHERE (${predicate})` : ""}`,
      );
      if (rows.length === 0) return rejected("no observations match; nothing was saved");
      try {
        const set = await state.observationSets.create(rowWords(rows.map((row) => Number(row.__row_index__))));
        return ok(
          { ...set, clause: { op: "inSet", set: set.set } },
          `→ ${set.count.toLocaleString("en-US")} obs saved`,
        );
      } catch (error) {
        return rejected(error instanceof Error ? error.message : String(error));
      }
    },
  );

  return server;
}
