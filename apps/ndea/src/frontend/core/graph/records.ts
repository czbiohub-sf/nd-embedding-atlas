import type { JsonValue, PortKind } from "@ndea/sdk";

/**
 * App-local graph roles. `cache` is the active checkpoint role; `selection`
 * remains only so versioned Workspace documents can still be migrated.
 */
export type GraphNodeRole = "source" | "transform" | "view" | "cache" | "selection" | "subnet" | "proxy";

/** App-local node type identities. Exact version refs remain SDK-owned. */
export type GraphNodeType =
  | "obs"
  | "dataset"
  | "threshold"
  | "wrangle"
  | "annotate"
  | "count"
  | "table"
  | "scatter"
  | "count-plot"
  | "histogram"
  | "gallery"
  | "fov"
  | "collection"
  | "export"
  | "cache"
  | "selection"
  | "subnet"
  | "proxy";

/** One persisted node record inside a Workspace graph document. */
export interface GraphDocumentNode {
  id: string;
  type: GraphNodeType;
  kind: GraphNodeRole;
  label: string;
  pluginId: string | null;
  parent?: string | null;
  stamp?: number;
  config?: JsonValue;
}

/** One persisted typed wire inside a Workspace graph document. */
export interface GraphDocumentEdge {
  id: string;
  from: string;
  to: string;
  toPort: string;
  kind: PortKind;
}
