/**
 * Graph semantics of every native node, by node type id. Browser-free: the
 * browser and the server evaluate the same document with these cooks, so
 * both compute identical results. Contributions add React bodies on top.
 */

import type { DatasetConfig } from "@ndea/nodes/dataset";
import { filterClauseSql, type FilterConfig } from "@ndea/nodes/filter";
import type { WrangleConfig } from "@ndea/nodes/wrangle";
import {
  andGraphPredicate,
  lastPortValueOfKind,
  nodeConfig,
  NULL_PREDICATE_PORT_VALUE,
  passthroughGraphPredicate,
  type GraphNodeCookFunction,
} from "./cook";
import type { GraphNodeRole } from "./records";

export interface NativeNodeGraph {
  readonly role: GraphNodeRole;
  readonly evaluationRole: "source" | "transform" | "view";
  readonly cook: GraphNodeCookFunction;
}

const view: NativeNodeGraph = { role: "view", evaluationRole: "view", cook: passthroughGraphPredicate };

export const NATIVE_NODE_GRAPH = {
  obs: { role: "source", evaluationRole: "source", cook: () => NULL_PREDICATE_PORT_VALUE },
  dataset: {
    role: "source",
    evaluationRole: "source",
    cook: (_inputs, host) => {
      const key = nodeConfig<DatasetConfig>(host.node()).datasetKey;
      return { kind: "pred", sql: key ? `_dataset = '${key.replace(/'/g, "''")}'` : null };
    },
  },
  filter: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => {
      const where = nodeConfig<FilterConfig>(host.node()).where;
      return andGraphPredicate(inputs, where ? filterClauseSql(where) : null);
    },
  },
  wrangle: {
    role: "transform",
    evaluationRole: "transform",
    cook: (inputs, host) => andGraphPredicate(inputs, nodeConfig<WrangleConfig>(host.node()).predicateSql ?? null),
  },
  /** Live passthrough until pinned; a pin is per-tab runtime state, so the server always sees it live. */
  cache: {
    role: "cache",
    evaluationRole: "transform",
    cook: (inputs, host) => {
      const frozen = host.frozenPredicate();
      return frozen !== undefined ? { kind: "pred", sql: frozen } : passthroughGraphPredicate(inputs);
    },
  },
  proxy: { role: "proxy", evaluationRole: "transform", cook: passthroughGraphPredicate },
  subnet: { role: "subnet", evaluationRole: "view", cook: passthroughGraphPredicate },
  annotate: view,
  count: view,
  "count-plot": view,
  histogram: view,
  vgplot: view,
  scatter: view,
  table: view,
  /** A pushed selection (lasso) takes over; else the AND of incoming predicates. */
  gallery: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => lastPortValueOfKind(inputs, "sel") ?? passthroughGraphPredicate(inputs),
  },
  "image-viewer": {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => ({ kind: "focus", rowIndex: lastPortValueOfKind(inputs, "focus")?.rowIndex ?? null }),
  },
} as const satisfies Record<string, NativeNodeGraph>;
