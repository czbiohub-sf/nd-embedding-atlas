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

export { defineNode, exactNodeTypeRef, nodeInstanceId, nodeTypeId, nodeTypeVersion, rowIndex } from "./node";
export type {
  ExactNodeTypeRef,
  NodeCapability,
  NodeConfigContract,
  NodeDefinition,
  NodeDocumentation,
  NodeInstanceId,
  NodePresentationHints,
  NodeTypeId,
  NodeTypeVersion,
  RowIndex,
} from "./node";

export type { MountedNodeBody, NodeModule, NodeRuntime } from "./module";
export type { PluginAPI, PluginDisposer, PluginFactory } from "./plugin";

export type {
  AnnotationWriteAPI,
  ColorCoordinationAPI,
  DataContext,
  DataQueryAPI,
  DeviceInfo,
  DeviceLease,
  FilterCoordinationAPI,
  FilterFacet,
  FocusCoordinationAPI,
  MaterializedFilterRows,
  NodeDataAPI,
  NodeHost,
  NodeNotificationAPI,
  OrderingCoordinationAPI,
  RowSetPublishAPI,
  ResolvedFilter,
  ViewCoordinationAPI,
} from "./host";

export type { JsonValue } from "./json";

export {
  compareSemanticVersions,
  isSemanticVersion,
  isVersionCompatible,
  nodeAssetVersion,
  sdkMajor,
  SDK_VERSION,
  sdkVersion,
  workspaceDocumentVersion,
} from "./version";
export type { NodeAssetVersion, SDKVersion, WorkspaceDocumentVersion } from "./version";

export type DataCapabilitySet = ReadonlySet<DataCapability>;

export function capabilitiesOf(metadata: Pick<Metadata, "capabilities">): DataCapabilitySet {
  return new Set(metadata.capabilities ?? []);
}
