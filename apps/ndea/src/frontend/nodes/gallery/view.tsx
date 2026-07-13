/**
 * Gallery plugin view (PLUGIN-ARCHITECTURE §10.5).
 *
 * Node contract: a gallery node shows NOTHING until it is wired — so it gates on
 * its cooked input predicate (`host.inputSelection`). Unwired (null predicate) →
 * a "connect an input" hint; wired → the crop gallery.
 *
 * The gallery CONTENT is scoped to `host.inputSelection` exactly: the cooked
 * input predicate is passed to `GalleryPane`, which resolves it to row ids via
 * `host.data.coordinator` (NOT the global selection bus). Two galleries wired to
 * different selections show different crops.
 */

import { useCallback, useSyncExternalStore } from "react";
import { focusObs } from "@/nodes/gallery/routing";
import { GalleryPane } from "@/nodes/gallery/GalleryPane";
import { predicateToSql } from "@/lib/mosaic-helpers";
import type { NodeBodyProps } from "@/core/node/app-node-host";

export interface GalleryConfig {
  /** Reserved: per-instance gallery layout (Phase 3). */
  lanes: number | null;
}

export type GalleryOptions = Record<string, never>;

export function GalleryPluginView({ host }: NodeBodyProps<GalleryConfig>) {
  // host.inputSelection is a Mosaic Selection that MUTATES IN PLACE on re-cook
  // and notifies Mosaic clients via "value" events — NOT React. Bridge it so the
  // unwired gate AND GalleryPane's query key recompute when the wired input
  // changes; without this the crops go stale after the upstream re-cooks.
  const selection = host.inputPredicate;
  const subscribe = useCallback(
    (onChange: () => void) => {
      selection.addEventListener("value", onChange);
      return () => selection.removeEventListener("value", onChange);
    },
    [selection],
  );
  const predicate = useSyncExternalStore(subscribe, () => predicateToSql(selection));

  // Highlight rides the SCOPED host seam (group-aware), NOT the global dashboard
  // state — same as ScatterView/Table. A crop click writes through
  // host.highlight.set so a shared sync group ("A") fans it out to Scatter +
  // Idetik; the read reflects the group's effective focus so the card lights up.
  const subscribeHighlight = useCallback(
    (onChange: () => void) => host.focus.subscribe?.(onChange) ?? (() => {}),
    [host],
  );
  const highlightId = useSyncExternalStore(subscribeHighlight, () => host.focus.get());
  const onSelect = useCallback((id: string | null) => focusObs(host, id), [host]);

  if (predicate == null) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="font-medium text-foreground/70 text-xs">No input wired</div>
        <div className="max-w-[240px] text-2xs text-muted-foreground/60 leading-relaxed">
          Connect a Filter, Selection, or scatter lasso to this gallery node to view crops.
        </div>
      </div>
    );
  }
  return (
    <GalleryPane
      coordinator={host.data.coordinator}
      predicate={predicate}
      highlightId={highlightId}
      onSelect={onSelect}
    />
  );
}
