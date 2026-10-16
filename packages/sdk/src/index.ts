/** Stable component-author API. Import author contracts only from this barrel. */

import type { DataCapability, Metadata } from "@ndea/protocol";

export type { DataCapability, Metadata };

export { defineComponent, rowIndex } from "./component";
export type {
  ComponentDefinition,
  ComponentDocumentation,
  ComponentModule,
  ConfigContract,
  CoordinationType,
  MountedBody,
  RowIndex,
} from "./component";

export type {
  AnnotationWriteAPI,
  ColorCoordinationAPI,
  ComponentHost,
  DataAPI,
  DataContext,
  DataQueryAPI,
  DeviceInfo,
  DeviceLease,
  FilterCoordinationAPI,
  FilterFacet,
  FocusCoordinationAPI,
  MaterializedFilterRows,
  NotificationAPI,
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
