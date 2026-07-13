/**
 * Table cross-view routing (Humble Object) — the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. A row click focuses that
 * obs through the host seam (sync-group aware), never the global bus.
 *
 * ponytail: thin today (one gesture). The value is a uniform, lint-guarded,
 * headless-testable routing point every body shares — not the line count.
 */

import type { NodeHost, RowIndex } from "@ndea/sdk";

type TableFocusHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;
type TableOrderingHost = Pick<NodeHost<unknown, "ordering-coordination">, "ordering">;
/** Focus the obs of a clicked row. Routes through the group-aware host seam. */
export function focusRow(host: TableFocusHost, focusedRowIndex: RowIndex | null): void {
  host.focus.set(focusedRowIndex);
}

/** Publish this table's sort onto its `ordering` coordination scope. A no-op
 *  when the table isn't ordering-scoped (the local sort stays local). */
export function publishOrdering(host: TableOrderingHost, sort: { col: string; dir: "asc" | "desc" } | null): void {
  host.ordering.set(sort);
}
