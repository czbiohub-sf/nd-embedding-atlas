/**
 * Server-side graph evaluation of the workspace document, with the same
 * definitions and cooks the browser uses, so agents read the results a
 * freshly opened tab would compute.
 */

import type { GraphPortValue } from "@ndea/graph";
import { createNodeCatalog, type NodeCatalogServices } from "@ndea/nodes/catalog";
import type { ExactNodeTypeRef, NodeConfigContract, NodeDefinition } from "@ndea/sdk";
import { NATIVE_NODE_GRAPH, type NativeNodeGraph } from "../frontend/core/graph/native-graph.ts";
import {
  GraphRuntimeSession,
  type GraphRuntimeNodeResolver,
  type GraphRuntimeNodeSpec,
} from "../frontend/core/graph/runtime-session.ts";
import { decodeNodeConfigs, type WorkspaceIssue } from "../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import type { WorkspaceDocumentStore } from "./workspace.ts";
import { filterScopeSql } from "../frontend/core/coordination/types.ts";

export type NodeEvaluation =
  | { revision: number; status: "missing" }
  | { revision: number; status: "unresolved" }
  | { revision: number; status: "error"; error: string }
  | { revision: number; status: "resolved"; value: GraphPortValue; scopeFilter: string | null };

/** The parts of an SDK definition the server reads: ports, capabilities, docs, and the config contract. */
export type ServerNodeDefinition = Pick<
  NodeDefinition,
  "ref" | "title" | "role" | "inputs" | "outputs" | "capabilities" | "documentation"
> & { readonly config?: NodeConfigContract };

type ServerNodeSpec = GraphRuntimeNodeSpec & { readonly definition: ServerNodeDefinition };

export interface ServerNodeResolver extends GraphRuntimeNodeResolver {
  getSpecExact(ref: ExactNodeTypeRef): ServerNodeSpec | undefined;
  /** Every native definition, one per node type (the current version). */
  readonly definitions: readonly ServerNodeDefinition[];
}

function refKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noBodiesOnServer(): never {
  throw new Error("node bodies are not available on the server");
}

/**
 * Every native definition paired with its cook. Bodies and their services
 * belong to the browser: `load()` is never called here, so they stay empty.
 */
export function createServerNodeResolver(): ServerNodeResolver {
  const catalog = createNodeCatalog({ mountBody: noBodiesOnServer, services: {} as NodeCatalogServices });
  const graphs: Readonly<Record<string, NativeNodeGraph>> = NATIVE_NODE_GRAPH;
  const specs = new Map<string, ServerNodeSpec>();
  for (const definition of Object.values(catalog)) {
    const graph = graphs[definition.ref.nodeTypeId];
    if (!graph) throw new Error(`native node "${definition.ref.nodeTypeId}" has no graph semantics`);
    specs.set(refKey(definition.ref), { definition, evaluationRole: graph.evaluationRole, cook: graph.cook });
  }
  return { getSpecExact: (ref) => specs.get(refKey(ref)), definitions: Object.values(catalog) };
}

/** Native definitions never change at runtime, so every server path shares one resolver. */
export const SERVER_NODE_RESOLVER: ServerNodeResolver = createServerNodeResolver();

/** Decode configs and register the whole graph; throws on bad configs, ports, scopes, or cycles. */
function loadGraph(document: WorkspaceDocument, resolver: ServerNodeResolver): GraphRuntimeSession {
  const nodes = decodeNodeConfigs(document.nodes, resolver);
  const session = new GraphRuntimeSession({
    resolver,
    document: {
      node: (id) => nodes[id],
      edges: () => Object.values(document.edges),
      scopeFilter: (id) => filterScopeSql(document, id),
    },
  });
  session.load({ nodes, edges: document.edges, flags: document.flags });
  return session;
}

/**
 * What the browser would refuse to load: config migrations, port and parent
 * rules, and cycles. Nodes the server cannot resolve (plugins, assets) pass,
 * as they do in the browser until their definitions arrive.
 */
export function graphIssues(document: WorkspaceDocument, resolver = SERVER_NODE_RESOLVER): WorkspaceIssue[] {
  try {
    loadGraph(document, resolver).dispose();
    return [];
  } catch (error) {
    const detail = errorMessage(error);
    const subject = /\b(edge|node) "([^"]+)"/.exec(detail);
    const pointer = subject ? `/${subject[1]}s/${subject[2].replaceAll("~", "~0").replaceAll("/", "~1")}` : "";
    return [{ pointer, detail }];
  }
}

/** Lazily evaluates the current revision; one runtime per revision. */
export class WorkspaceEvaluator {
  private readonly workspace: WorkspaceDocumentStore;
  private readonly resolver: ServerNodeResolver;
  private current: { revision: number; session: GraphRuntimeSession | null; error: string } | undefined;

  constructor(workspace: WorkspaceDocumentStore, resolver: ServerNodeResolver = SERVER_NODE_RESOLVER) {
    this.workspace = workspace;
    this.resolver = resolver;
  }

  evaluate(nodeId: string): NodeEvaluation {
    const { revision, document } = this.workspace.snapshot();
    // The store only holds documents that passed `parseWorkspaceDocument`.
    const doc = document as WorkspaceDocument | null;
    const node = doc?.nodes[nodeId];
    if (!doc || !node) return { revision, status: "missing" };
    if (!this.resolver.getSpecExact(node.definitionRef)) return { revision, status: "unresolved" };

    const { session, error } = this.at(revision, doc);
    if (!session) return { revision, status: "error", error };
    try {
      const value = session.pull(nodeId);
      return { revision, status: "resolved", value, scopeFilter: filterScopeSql(doc, nodeId) };
    } catch (pullError) {
      return { revision, status: "error", error: errorMessage(pullError) };
    }
  }

  // ponytail: rebuilds the runtime once per revision; reconcile incrementally if documents reach hundreds of nodes.
  private at(revision: number, document: WorkspaceDocument) {
    if (this.current?.revision === revision) return this.current;
    this.current?.session?.dispose();
    try {
      this.current = { revision, session: loadGraph(document, this.resolver), error: "" };
    } catch (error) {
      this.current = { revision, session: null, error: errorMessage(error) };
    }
    return this.current;
  }
}
