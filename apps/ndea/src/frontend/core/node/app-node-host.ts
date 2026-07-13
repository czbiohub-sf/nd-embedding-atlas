import type { NodeCapability, NodeHost } from "@ndea/sdk";

/**
 * Temporary native-node adapter surface. Product header placement remains
 * app-local while SDK-authored hosts stay layout-neutral.
 */
export type AppNodeHost<Config = unknown, Capabilities extends NodeCapability = NodeCapability> = NodeHost<
  Config,
  Capabilities
> & {
  readonly bodyHeaderElement?: HTMLElement;
};

export interface NodeBodyProps<Config = unknown, Capabilities extends NodeCapability = NodeCapability> {
  readonly host: AppNodeHost<Config, Capabilities>;
}
