export * from "./color";
export * from "./colormap";
export * from "./normalize";

// Namespaced operation facades. Tree-shakeable via named re-exports inside.
// Access as `Color.toOkLab(c)` or `Cmap.map(cmap, t)`.
export * as Color from "./color/ops";
export * as Cmap from "./colormap/ops";
