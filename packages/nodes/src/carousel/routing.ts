/**
 * Carousel cross-view routing (Humble Object): the testable seam the conformance
 * suite (`core/node/host-routing.test.ts`) exercises.
 *
 * The carousel is a focus EMITTER with two discrete gestures — clicking a slide,
 * and sliding the active variant into view — and both mean the same thing: "this
 * variant is now the subject". Routing them through the group-aware host seam is
 * what lets a wired Image Viewer show the selected variant live, which is how the
 * node escalates past its own server-rendered crops.
 */

import type { NodeHost, RowIndex } from "@ndea/sdk";

type FocusHost = Pick<NodeHost<unknown, "focus-coordination">, "focus">;

/** Focus the variant a slide represents. Routes through the group-aware host seam. */
export function focusVariant(host: FocusHost, focusedRowIndex: RowIndex | null): void {
  host.focus.set(focusedRowIndex);
}
