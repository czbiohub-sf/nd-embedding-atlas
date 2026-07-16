/**
 * Gallery cross-view routing (Humble Object) — the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises. A crop click focuses that
 * obs through the host seam (sync-group aware), never the global bus.
 *
 * ponytail: thin today (one gesture). The value is a uniform, lint-guarded,
 * headless-testable routing point every body shares — not the line count.
 */

import type { NodeHost, RowIndex } from "@ndea/sdk";

type FocusHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;

/** Focus the obs under a clicked crop. Routes through the group-aware host seam. */
export function focusObs(host: FocusHost, focusedRowIndex: RowIndex | null): void {
  host.focus.set(focusedRowIndex);
}
