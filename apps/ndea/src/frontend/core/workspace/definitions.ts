import { registerDefinition } from "@/core/node/registry";
import { annotateDefinition } from "@/nodes/annotate/plugin";
import { countPlotDefinition } from "@/nodes/charts/count-plot/plugin";
import { histogramDefinition } from "@/nodes/charts/histogram/plugin";
import { galleryDefinition } from "@/nodes/gallery/plugin";
import { imageViewerDefinition } from "@/nodes/image-viewer/plugin";
import { scatterDefinition } from "@/nodes/scatter/plugin";
import { tableDefinition } from "@/nodes/table/plugin";
import { transformFilterDefinition } from "@/nodes/transform-filter/plugin";
import { registerBuiltinNodes } from "./nodes";

let registered = false;

/** Register every app-owned graph node and definition once, in stable order. */
export function registerBuiltins(): void {
  if (registered) return;

  registerBuiltinNodes();
  registerDefinition(scatterDefinition);
  registerDefinition(tableDefinition);
  registerDefinition(imageViewerDefinition);
  registerDefinition(countPlotDefinition);
  registerDefinition(histogramDefinition);
  registerDefinition(galleryDefinition);
  registerDefinition(transformFilterDefinition);
  registerDefinition(annotateDefinition);

  registered = true;
}
