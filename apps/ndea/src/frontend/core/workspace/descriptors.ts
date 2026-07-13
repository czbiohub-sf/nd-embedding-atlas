import { registerDescriptor } from "@/core/node/registry";
import { annotateDescriptor } from "@/nodes/annotate/plugin";
import { countPlotDescriptor } from "@/nodes/charts/count-plot/plugin";
import { histogramDescriptor } from "@/nodes/charts/histogram/plugin";
import { galleryDescriptor } from "@/nodes/gallery/plugin";
import { imageViewerDescriptor } from "@/nodes/image-viewer/plugin";
import { scatterDescriptor } from "@/nodes/scatter/plugin";
import { tableDescriptor } from "@/nodes/table/plugin";
import { transformFilterDescriptor } from "@/nodes/transform-filter/plugin";
import { registerBuiltinNodes } from "./nodes";

let registered = false;

/** Register every app-owned node spec and descriptor once, in stable order. */
export function registerBuiltins(): void {
  if (registered) return;

  registerBuiltinNodes();
  registerDescriptor(scatterDescriptor);
  registerDescriptor(tableDescriptor);
  registerDescriptor(imageViewerDescriptor);
  registerDescriptor(countPlotDescriptor);
  registerDescriptor(histogramDescriptor);
  registerDescriptor(galleryDescriptor);
  registerDescriptor(transformFilterDescriptor);
  registerDescriptor(annotateDescriptor);

  registered = true;
}
