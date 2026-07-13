import type { JsonValue, PortKind } from "@ndea/sdk";

/** App-local graph roles. Cache is the sole checkpoint role. */
export type GraphNodeRole = "source" | "transform" | "view" | "cache" | "subnet" | "proxy";

/**
 * Persisted node type identity. Resolution is catalog-owned, so this remains
 * open to validated external definitions rather than duplicating built-in IDs.
 */
export type GraphNodeType = string;

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
