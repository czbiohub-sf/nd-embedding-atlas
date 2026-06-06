/**
 * Cross-view buses (PLUGIN-ARCHITECTURE §6) — the thin seams a `PluginHost`
 * maps its facets onto. Each wraps exactly one of today's TanStack stores with
 * zero behavior change; `useDashboardHostShim` composes them into a live host.
 */

export { type SelectionBus, type SelectionFacet, createSelectionBus, selectionBus } from "./selection-bus";
export { type BroadcastBus, createBroadcastBus, broadcastBus } from "./broadcast-bus";
export { type ViewSyncBus, createViewSyncBus, viewSyncBus } from "./view-sync-bus";
export { type RenderBus, createRenderBus, renderBus } from "./render-bus";
