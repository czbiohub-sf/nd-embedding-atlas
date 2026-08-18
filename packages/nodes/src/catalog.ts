import type { NodeBodyMounter } from "./contracts";
import { createAnnotateDefinition } from "./annotate/definition";
import type { AnnotateServices } from "./annotate/services";
import { createCacheDefinition } from "./cache/definition";
import type { CacheCheckpointResolver, CacheIconButton } from "./cache/contracts";
import { createCountPlotDefinition } from "./charts/count-plot/definition";
import { createHistogramDefinition } from "./charts/histogram/definition";
import { createVgplotDefinition } from "./charts/vgplot/definition";
import type { ChartServices } from "./charts/core/contracts";
import { createCountDefinition } from "./count/definition";
import type { CountPredicateToSql } from "./count/contracts";
import { createBuiltinNodeDefinitions } from "./core-catalog";
import { createDatasetDefinition } from "./dataset/definition";
import { createGalleryDefinition } from "./gallery/definition";
import { createCarouselDefinition } from "./carousel/definition";
import type { CarouselServices } from "./carousel/contracts";
import type { GalleryServices } from "./gallery/contracts";
import { createImageViewerDefinition } from "./image-viewer/definition";
import type { ImageViewerServices } from "./image-viewer/contracts";
import { createScatterDefinition } from "./scatter/definition";
import type { ScatterServices } from "./scatter/contracts";
import { createSubnetDefinition } from "./subnet/definition";
import type { SubnetHierarchyResolver, SubnetIconButton } from "./subnet/contracts";
import { createTableDefinition } from "./table/definition";
import type { TableServices } from "./table/contracts";
import { createTransformFilterDefinition } from "./transform-filter/definition";
import type { TransformFilterColumnTypesService } from "./transform-filter/contracts";
import { createWrangleDefinition } from "./wrangle/definition";
import type { WrangleEditor } from "./wrangle/contracts";

export { createBuiltinNodeDefinitions } from "./core-catalog";

/** App-owned integrations required to construct complete portable node catalog. */
export interface NodeCatalogServices {
  readonly annotate: { useServices: () => AnnotateServices };
  readonly cache: { getCheckpoint: CacheCheckpointResolver; IconButton: CacheIconButton };
  readonly charts: ChartServices;
  readonly count: { predicateToSql: CountPredicateToSql };
  readonly gallery: { useServices: () => GalleryServices };
  readonly imageViewer: ImageViewerServices;
  readonly scatter: ScatterServices;
  readonly subnet: { getHierarchy: SubnetHierarchyResolver; IconButton: SubnetIconButton };
  readonly table: { useServices: () => TableServices };
  readonly transformFilter: { getColumnTypes: TransformFilterColumnTypesService };
  readonly carousel: { useServices: () => CarouselServices };
  readonly wrangle: { Editor: WrangleEditor };
}

/** Construct full built-in catalog without importing app adapters into package code. */
export function createNodeCatalog({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: NodeCatalogServices;
}) {
  return {
    ...createBuiltinNodeDefinitions({ mountBody }),
    dataset: createDatasetDefinition({ mountBody }),
    transformFilter: createTransformFilterDefinition({ mountBody, ...services.transformFilter }),
    wrangle: createWrangleDefinition({ mountBody, ...services.wrangle }),
    annotate: createAnnotateDefinition({ mountBody, ...services.annotate }),
    count: createCountDefinition({ mountBody, ...services.count }),
    table: createTableDefinition({ mountBody, useServices: services.table.useServices }),
    scatter: createScatterDefinition({ mountBody, services: services.scatter }),
    countPlot: createCountPlotDefinition({ mountBody, services: services.charts }),
    histogram: createHistogramDefinition({ mountBody, services: services.charts }),
    vgplot: createVgplotDefinition(),
    gallery: createGalleryDefinition({ mountBody, ...services.gallery }),
    carousel: createCarouselDefinition({ mountBody, ...services.carousel }),
    imageViewer: createImageViewerDefinition({ mountBody, services: services.imageViewer }),
    cache: createCacheDefinition({ mountBody, ...services.cache }),
    subnet: createSubnetDefinition({ mountBody, ...services.subnet }),
  } as const;
}
