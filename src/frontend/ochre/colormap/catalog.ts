// Catalog root. Provides:
//
//   - Popular top-level names directly (`catalog.viridis`, `catalog.tab10`, …).
//     Canonical source per name, curated in `./popular.ts`.
//
//   - Per-source namespaces for full access to every ported colormap
//     (`catalog.colorcet.CET_C1`, `catalog.colorbrewer.Blues_9`, …).

// Popular entries as flat members on catalog.
export * from "./popular";

// Per-source namespaces (multi-entry sources; single-entry ones live only on
// `popular` to avoid name/namespace collision).
export * as bids from "./catalog/bids";
export * as matplotlib from "./catalog/matplotlib";
export * as colorcet from "./catalog/colorcet";
export * as colorbrewer from "./catalog/colorbrewer";
export * as crameri from "./catalog/crameri";
export * as cmocean from "./catalog/cmocean";
export * as cmasher from "./catalog/cmasher";
export * as tableau from "./catalog/tableau";
export * as tol from "./catalog/tol";
export * as seaborn from "./catalog/seaborn";
export * as okabeito from "./catalog/okabeito";
export * as paraview from "./catalog/paraview";
export * as petroff from "./catalog/petroff";
export * as observable from "./catalog/observable";
export * as ibm from "./catalog/ibm";
export * as matlab from "./catalog/matlab";
export * as napari from "./catalog/napari";
export * as vispy from "./catalog/vispy";
export * as imagej from "./catalog/imagej";
export * as yorick from "./catalog/yorick";
export * as contrib from "./catalog/contrib";
export * as chrisluts from "./catalog/chrisluts";
