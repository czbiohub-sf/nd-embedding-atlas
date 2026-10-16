import type { BodyMounter } from "./contracts";
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

/** App-owned integrations the built-in view bodies need. */
export interface ComponentServices {
  readonly annotate: { useServices: () => AnnotateServices };
  readonly charts: ChartServices;
  readonly count: { predicateToSql: CountPredicateToSql };
  readonly gallery: { useServices: () => GalleryServices };
  readonly imageViewer: ImageViewerServices;
  readonly scatter: ScatterServices;
}

/** Every built-in view definition; each is one dashboard component, keyed by its type. */
export function createComponentCatalog({
  mountBody,
  services,
}: {
  mountBody: BodyMounter;
  services: ComponentServices;
}) {
  return {
    annotate: createAnnotateDefinition({ mountBody, ...services.annotate }),
    count: createCountDefinition({ mountBody, ...services.count }),
    table: createTableDefinition({ mountBody }),
    scatter: createScatterDefinition({ mountBody, services: services.scatter }),
    countPlot: createCountPlotDefinition({ mountBody, services: services.charts }),
    histogram: createHistogramDefinition({ mountBody, services: services.charts }),
    vgplot: createVgplotDefinition(),
    gallery: createGalleryDefinition({ mountBody, ...services.gallery }),
    imageViewer: createImageViewerDefinition({ mountBody, services: services.imageViewer }),
  } as const;
}
