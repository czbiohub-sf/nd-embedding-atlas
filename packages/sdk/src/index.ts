/** Stable node-author API. Import author contracts only from this barrel. */

import type { DataCapability, Metadata } from "@ndea/protocol";

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

export type DataCapabilitySet = ReadonlySet<DataCapability>;

export function capabilitiesOf(metadata: Pick<Metadata, "capabilities">): DataCapabilitySet {
  return new Set(metadata.capabilities ?? []);
}
