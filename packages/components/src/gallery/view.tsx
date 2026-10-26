/**
 * Gallery view.
 *
 * Shows nothing until its filter scope narrows the data source: it gates on
 * `host.predicate` (the element's filter-scope predicate). Unfiltered
 * (null predicate) → a hint; filtered → the crop gallery.
 *
 * The predicate is passed to `GalleryPane`, which resolves it to row ids via
 * `host.data.coordinator` (NOT the global selection bus). Two galleries with
 * different filter scopes show different crops.
 */

import { useCallback } from "react";
import type { RowIndex } from "@ndea/sdk";
import { GalleryPane } from "./GalleryPane";
import { usePredicateSql } from "../query/mosaic";
import type { BodyProps } from "../contracts";
import { useFocus } from "../query/useFocus";
import type { GalleryServices } from "./contracts";

export function GalleryView({ host, services }: BodyProps<unknown> & { services: GalleryServices }) {
  // host.predicate is a Mosaic Selection that mutates in place when a
  // filter in scope changes; `usePredicateSql` bridges it so the empty gate
  // AND GalleryPane's query key recompute (else crops go stale).
  const predicate = usePredicateSql(host.predicate);

  // Focus rides the scoped host seam (group-aware), not the process-wide bus.
  // state: same as ScatterView/Table. A crop click writes through
  // host.focus.set so a shared sync group ("A") fans it out to Scatter +
  // Idetik; the read reflects the group's effective focus so the card lights up.
  const focusedRowIndex = useFocus(host);
  const onSelect = useCallback((rowIndex: RowIndex | null) => host.focus.set(rowIndex), [host]);

  if (predicate == null) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="font-medium text-foreground/70 text-ui">Nothing selected</div>
        <div className="max-w-[240px] text-sm text-muted-foreground/60 leading-relaxed">
          Narrow its data source or filter scope (a lasso, a chart brush, a select) to view crops.
        </div>
      </div>
    );
  }
  return (
    <GalleryPane
      coordinator={host.data.coordinator}
      predicate={predicate}
      focusedRowIndex={focusedRowIndex}
      onSelect={onSelect}
      services={services.dataset}
    />
  );
}
