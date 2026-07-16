import type { NodeCapability, NodeDefinition } from "./node";

export interface PluginAPI {
  registerNode<Config, Capabilities extends readonly NodeCapability[]>(
    definition: NodeDefinition<Config, Capabilities>,
  ): void;
}

export type PluginDisposer = () => void;

export type PluginFactory = (api: PluginAPI) => void | PluginDisposer | Promise<void | PluginDisposer>;
