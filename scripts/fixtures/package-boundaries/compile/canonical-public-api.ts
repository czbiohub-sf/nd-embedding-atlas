import {
  AnnotationColumnBodySchema,
  EmbeddingStatusSchema,
  PluginManifestSchema,
  type CommitAnnotationsResponse,
  type NdeaProtocol,
  type PluginBootstrapCatalog,
} from "@ndea/protocol";
import {
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  type MountedNodeBody,
  type NodeDefinition,
  type NodeHost,
  type NodeModule,
  type PluginFactory,
} from "@ndea/sdk";
import {
  AnnData,
  BunFileStore,
  LazyDataFrame,
  MuData,
  commitObsColumns,
  open,
  openAnnData,
  openMuData,
  toArrowTable,
  type DatasetHandle,
  type ParsedStore,
} from "@ndea/zarr";

export const canonicalRuntimeSurface = [
  AnnotationColumnBodySchema,
  EmbeddingStatusSchema,
  PluginManifestSchema,
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  AnnData,
  BunFileStore,
  LazyDataFrame,
  MuData,
  commitObsColumns,
  open,
  openAnnData,
  openMuData,
  toArrowTable,
] as const;

export type CanonicalTypeSurface = [
  CommitAnnotationsResponse,
  NdeaProtocol,
  PluginBootstrapCatalog,
  MountedNodeBody,
  NodeDefinition,
  NodeHost,
  NodeModule,
  PluginFactory,
  DatasetHandle,
  ParsedStore,
];
