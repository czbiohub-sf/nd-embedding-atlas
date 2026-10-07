/**
 * Graph semantics of every native node, by node type id. Browser-free: the
 * browser and the server evaluate the same document with these cooks, so
 * both compute identical results. Contributions add React bodies on top.
 */

import type { CacheConfig } from "@ndea/nodes/cache";
import type { DatasetConfig } from "@ndea/nodes/dataset";
import { filterClauseSql, type FilterConfig } from "@ndea/nodes/filter";
import type { WrangleConfig } from "@ndea/nodes/wrangle";
import {
  andGraphPredicate,
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

/** A view shows its inputs narrowed by every other source in its filter scope. */
const view: NativeNodeGraph = {
  role: "view",
  evaluationRole: "view",
  cook: (inputs, host) => andGraphPredicate(inputs, host.scopeFilter()),
};

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
  /** Pinned: its observation set. Live: its input AND its filter scope. */
  cache: {
    role: "cache",
    evaluationRole: "transform",
    cook: (inputs, host) => {
      const pin = nodeConfig<CacheConfig>(host.node()).pin;
      return pin ? { kind: "pred", sql: filterClauseSql(pin.clause) } : andGraphPredicate(inputs, host.scopeFilter());
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
  gallery: view,
  "image-viewer": {
    role: "view",
    evaluationRole: "view",
    cook: () => NULL_PREDICATE_PORT_VALUE,
  },
} as const satisfies Record<string, NativeNodeGraph>;
