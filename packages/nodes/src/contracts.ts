import type { ComponentType } from "react";
import type { MountedNodeBody, NodeCapability, NodeHost } from "@ndea/sdk";

export interface NodeBodyProps<Config, Capabilities extends NodeCapability, Facets extends object = object> {
  readonly host: NodeHost<Config, Capabilities> & Facets;
}

export type NodeBodyMounter = <Config, Capabilities extends NodeCapability, Facets extends object = object>(
  component: ComponentType<NodeBodyProps<Config, Capabilities, Facets>>,
  host: NodeHost<Config, Capabilities> & Facets,
  title: string,
) => MountedNodeBody;
