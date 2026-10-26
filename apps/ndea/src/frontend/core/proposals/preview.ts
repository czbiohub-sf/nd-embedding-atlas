/**
 * The dashboard's preview of pending proposals. A change that adds a tile to
 * the active layout shows as a ghost tile in the grid (the ghost document is
 * the current one plus only those changes); every other change (props,
 * removals, sources, links, layouts) is listed for review instead, so the grid
 * never shows an unaccepted removal or rewrite. Pure: recomputed whenever the
 * document or the proposals change.
 */

import type { Proposal, ProposalChange } from "@ndea/protocol";

import { filterClauseSql } from "@ndea/components/filter";
import { activeSpec, layoutTiles, type Dashboard } from "@/core/workspace/dashboard";
import type { DataSources } from "@/core/workspace/data-sources";
import { applyDashboardEdits, DashboardEditSchema, type DashboardEdit } from "@/core/workspace/edits";
import type { WorkspaceDocument } from "@/core/workspace/types";

/** One pending change, with what the UI needs to show and decide it. */
export interface PendingChange {
  proposal: string;
  change: ProposalChange;
  /** `X-Ndea-Agent` of the proposer, or "harness". */
  agent: string;
  /** The parsed op; null when it does not parse (shown by its summary only). */
  edit: DashboardEdit | null;
}

export interface ProposalPreview {
  /** The current document plus the ghost-tile changes; null when there are none. */
  document: WorkspaceDocument | null;
  /** Ghost tile id → the change that adds it. */
  ghosts: ReadonlyMap<string, PendingChange>;
  /** Pending changes that are not ghost tiles, in proposal order. */
  review: PendingChange[];
  /** Every pending change, in proposal order. */
  pending: PendingChange[];
}

export const agentOf = (proposal: Proposal): string => proposal.actor.agent ?? "harness";

/** Tiles of a layout that hold views: every tile but the empty ones. */
function tileIds(spec: Dashboard): Set<string> {
  return new Set(layoutTiles(spec).filter((id) => spec.elements[id].type !== "slot"));
}

export function previewProposals(document: WorkspaceDocument, proposals: readonly Proposal[]): ProposalPreview {
  const pending: PendingChange[] = proposals.flatMap((proposal) =>
    proposal.changes
      .filter((change) => change.status === "pending")
      .map((change) => {
        const parsed = DashboardEditSchema.safeParse(change.op);
        return { proposal: proposal.id, change, agent: agentOf(proposal), edit: parsed.success ? parsed.data : null };
      }),
  );
  const ghosts = new Map<string, PendingChange>();
  const review: PendingChange[] = [];
  let ghostDoc = document;
  for (const item of pending) {
    const before = tileIds(activeSpec(ghostDoc));
    let next: WorkspaceDocument | null = null;
    // ponytail: only `add` can open a ghost tile; an `add_tab` into a new ghost tile goes to review.
    if (item.edit?.op === "add") {
      try {
        next = applyDashboardEdits(ghostDoc, [item.edit]);
      } catch {
        // No longer applies to the current document: the server marks it invalid on accept.
      }
    }
    // Ghosts show in the layout on screen, never a layout switch.
    const added =
      next && next.layout === ghostDoc.layout ? [...tileIds(activeSpec(next))].filter((id) => !before.has(id)) : [];
    if (next && added.length > 0) {
      ghostDoc = next;
      for (const id of added) ghosts.set(id, item);
    } else {
      review.push(item);
    }
  }
  return { document: ghosts.size > 0 ? ghostDoc : null, ghosts, review, pending };
}

/** A source in one line: `from …`, its clause, its SQL; "every obs" when it narrows nothing. */
export function sourceSummary(source: DataSources[string] | undefined): string {
  if (!source) return "no source";
  return (
    [source.from && `from ${source.from}`, source.where && filterClauseSql(source.where), source.sql]
      .filter(Boolean)
      .join(" · ") || "every obs"
  );
}
