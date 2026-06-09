/**
 * Gallery plugin view (PLUGIN-ARCHITECTURE §10.5).
 *
 * Phase 1: renders the existing `GalleryPane` (reads selection/active-filter
 * internally). Not mounted into any container yet — registered for the node
 * palette and wired into a real mount in Phase 3, where its predicate input
 * moves to `host.inputSelection` / `host.externalRowSet` and crops route through
 * `host.api.fetchCrop`.
 */

import { GalleryPane } from "@/components/gallery/GalleryPane";
import type { PluginViewProps } from "@/core/plugin/types";

export interface GalleryConfig {
  /** Reserved: per-instance gallery layout (Phase 3). */
  lanes: number | null;
}

export type GalleryOptions = Record<string, never>;

export function GalleryPluginView(_props: PluginViewProps<GalleryConfig, GalleryOptions>) {
  return <GalleryPane />;
}
