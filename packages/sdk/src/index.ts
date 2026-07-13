/** Public node authoring API. Host construction and registries remain app-local. */

import type { NodeSpec, NodeDescriptor } from "./types";
import type { DataCapability, Metadata } from "@ndea/protocol";
import { SDK_VERSION } from "./version";

export type {
  NodeSpec,
  NodeDescriptor,
  NodeMeta,
  NodeDoc,
  NodePort,
  DescriptorKind,
  NodeCapability,
  PortKind,
  FanInOp,
  NodePlacement,
  InstancePolicy,
  MountReason,
} from "./types";

export type { NodeViewProps, NodeInstance, NodeModule } from "./types";

export type {
  NodeHost,
  NodeContext,
  NodeSessionEvent,
  NodeInstanceId,
  DataContext,
  SelectionToken,
  DataApi,
  ViewSyncApi,
  OrderingApi,
  HighlightApi,
  RenderApi,
  PanelContext,
  UiApi,
  OptionsBuilder,
  DeviceInfo,
  DeviceLease,
} from "./host";
export { asInstanceId } from "./host";

export type { JsonValue } from "./json";
export type { DataCapability, Metadata } from "@ndea/protocol";
export type DataCapabilitySet = ReadonlySet<DataCapability>;

export function capabilitiesOf(metadata: Pick<Metadata, "capabilities">): DataCapabilitySet {
  return new Set(metadata.capabilities ?? []);
}

export { SDK_VERSION, sdkMajor } from "./version";

/** Stamps the current SDK version unless the descriptor pins one. */
export function defineDescriptor<Config, Options>(
  descriptor: NodeDescriptor<Config, Options>,
): NodeDescriptor<Config, Options> {
  return descriptor.sdkVersion ? descriptor : { ...descriptor, sdkVersion: SDK_VERSION };
}

export function defineNode<S extends NodeSpec>(spec: S): S {
  return spec;
}
