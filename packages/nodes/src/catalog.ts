import type { NodeBodyMounter } from "./contracts";
import { createAnnotateDefinition } from "./annotate/definition";
import type { AnnotateServices } from "./annotate/services";
import { createCountPlotDefinition } from "./charts/count-plot/definition";
import { createHistogramDefinition } from "./charts/histogram/definition";
import { createVgplotDefinition } from "./charts/vgplot/definition";
import type { ChartServices } from "./charts/core/contracts";
import { createCountDefinition } from "./count/definition";
import type { CountPredicateToSql } from "./count/contracts";
import { createGalleryDefinition } from "./gallery/definition";
import type { GalleryServices } from "./gallery/contracts";
import { createImageViewerDefinition } from "./image-viewer/definition";
import type { ImageViewerServices } from "./image-viewer/contracts";
import { createScatterDefinition } from "./scatter/definition";
import type { ScatterServices } from "./scatter/contracts";
import { createTableDefinition } from "./table/definition";
import type { TableServices } from "./table/contracts";

/** App-owned integrations the built-in view bodies need. */
export interface NodeCatalogServices {
  readonly annotate: { useServices: () => AnnotateServices };
  readonly charts: ChartServices;
  readonly count: { predicateToSql: CountPredicateToSql };
  readonly gallery: { useServices: () => GalleryServices };
  readonly imageViewer: ImageViewerServices;
  readonly scatter: ScatterServices;
  readonly table: TableServices;
}

/** Every built-in view definition; each is one dashboard component, keyed by node type id. */
export function createNodeCatalog({
  mountBody,
  services,
}: {
  mountBody: NodeBodyMounter;
  services: NodeCatalogServices;
}) {
  return {
    annotate: createAnnotateDefinition({ mountBody, ...services.annotate }),
    count: createCountDefinition({ mountBody, ...services.count }),
    table: createTableDefinition({ mountBody, services: services.table }),
    scatter: createScatterDefinition({ mountBody, services: services.scatter }),
    countPlot: createCountPlotDefinition({ mountBody, services: services.charts }),
    histogram: createHistogramDefinition({ mountBody, services: services.charts }),
    vgplot: createVgplotDefinition(),
    gallery: createGalleryDefinition({ mountBody, ...services.gallery }),
    imageViewer: createImageViewerDefinition({ mountBody, services: services.imageViewer }),
  } as const;
}
