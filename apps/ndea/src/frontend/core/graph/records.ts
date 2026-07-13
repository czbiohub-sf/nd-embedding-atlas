import type { ExactNodeTypeRef, NodeConfigSnapshot, PortKind } from "@ndea/sdk";

/** App-local graph roles. Cache is the sole checkpoint role. */
export type GraphNodeRole = "source" | "transform" | "view" | "cache" | "subnet" | "proxy";

/** One persisted node record inside a Workspace graph document. */
export interface GraphDocumentNode {
  id: string;
  definitionRef: ExactNodeTypeRef;
  label: string;
  parent?: string | null;
  stamp?: number;
  config?: NodeConfigSnapshot;
}

/** One persisted typed wire inside a Workspace graph document. */
export interface GraphDocumentEdge {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  kind: PortKind;
}
