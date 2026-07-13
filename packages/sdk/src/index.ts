/** Stable plugin and node-author API. Import author contracts only from this barrel. */

import type { DataCapability, Metadata } from "@ndea/protocol";

export {
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginHostCompatibilitySchema,
  PluginIdSchema,
  PluginManifestSchema,
  PluginManifestSchemaVersionSchema,
  PluginPackageVersionSchema,
  PluginPermissionDisclosureSchema,
  PluginPermissionSchema,
  PluginPlatformSchema,
  SDKVersionRangeSchema,
} from "@ndea/protocol";
export type {
  PluginHostCompatibility,
  PluginId,
  PluginManifest,
  PluginManifestSchemaVersion,
  PluginPackageVersion,
  PluginPermission,
  PluginPermissionDisclosure,
  PluginPlatform,
  SDKVersionRange,
} from "@ndea/protocol";
export type { DataCapability, Metadata };

export {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  nodeInstanceId,
  nodeTypeId,
  nodeTypeVersion,
  rowIndex,
} from "./node";
export type {
  ExactNodeTypeRef,
  FanInOperation,
  FocusPortValue,
  NodeAvailability,
  NodeAvailabilityCheck,
  NodeAvailabilityContext,
  NodeCapability,
  NodeCompute,
  NodeComputeContext,
  NodeComputeInputs,
  NodeComputeOutputs,
  NodeConfigContract,
  NodeConfigMigration,
  NodeConfigVersion,
  NodeDefinition,
  NodeDocumentation,
  NodeInstanceId,
  NodePort,
  NodePortValue,
  NodePresentationHints,
  NodeRole,
  NodeTypeId,
  NodeTypeVersion,
  PortKind,
  PredicatePortValue,
  RowSetPortValue,
  RowIndex,
} from "./node";

export type { MountedNodeBody, NodeModule, NodeRuntime } from "./module";
export type { PluginAPI, PluginDisposer, PluginFactory } from "./plugin";

export type {
  AnnotationWriteAPI,
  DataContext,
  DataQueryAPI,
  DeviceInfo,
  DeviceLease,
  FocusCoordinationAPI,
  NodeDataAPI,
  NodeHost,
  NodeNotificationAPI,
  OrderingCoordinationAPI,
  RowSetPublication,
  RowSetPublishAPI,
  ViewCoordinationAPI,
} from "./host";

export type { JsonValue } from "./json";

export { nodeAssetVersion, sdkMajor, SDK_VERSION, sdkVersion, workspaceDocumentVersion } from "./version";
export type { NodeAssetVersion, SDKVersion, WorkspaceDocumentVersion } from "./version";

export type DataCapabilitySet = ReadonlySet<DataCapability>;

export function capabilitiesOf(metadata: Pick<Metadata, "capabilities">): DataCapabilitySet {
  return new Set(metadata.capabilities ?? []);
}
