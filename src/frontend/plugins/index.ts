/**
 * Plugin barrel (PLUGIN-ARCHITECTURE §8). Importing this registers every
 * plugin's EAGER metadata. Engine code (TypeGPU, Idetik, ochre, roaring-wasm)
 * stays out of the boot graph — each descriptor's Component is behind a lazy
 * `load() => import()` chunk, so opening only a table never pays for scatter.
 *
 * `registerPlugins()` is idempotent across HMR (the registry throws on a true
 * duplicate id, but module caching means this body runs once per id).
 */

import { registerPlugin } from "@/core/plugin/registry";
import { chartsDescriptor } from "./charts";
import { galleryDescriptor } from "./gallery";
import { imageViewerDescriptor } from "./image-viewer";
import { scatterDescriptor } from "./scatter";
import { tableDescriptor } from "./table";

let registered = false;

export function registerPlugins(): void {
  if (registered) return;
  registered = true;
  registerPlugin(scatterDescriptor);
  registerPlugin(tableDescriptor);
  registerPlugin(imageViewerDescriptor);
  registerPlugin(chartsDescriptor);
  registerPlugin(galleryDescriptor);
}
