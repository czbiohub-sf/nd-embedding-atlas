/**
 * Proposal review: ghost tiles in the grid, the bar (bottom centre) with
 * Accept all / Reject all / Review over the changes that are not tiles, and
 * the change rows the Harness flyout reuses. Every decision goes to the
 * server; the document follows through `workspace/watch`.
 */

import type { ProposalChange } from "@ndea/protocol";
import { useState } from "react";

import { Button } from "@ndea/ui/components/button";
import { popoverFrame } from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";

import { COMPONENTS, type DashboardElement } from "@/core/workspace/dashboard";
import { DashboardEditSchema } from "@/core/workspace/edits";
import { useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { decide, decideAll, useProposals } from "./harness";
import { sourceSummary, type PendingChange } from "./preview";

/** Reject / Accept for one change. */
function Decide({ proposal, index }: { proposal: string; index: number }) {
  const [busy, setBusy] = useState(false);
  const run = (verdict: "accept" | "reject") => {
    setBusy(true);
    void decide(proposal, verdict, [index]).finally(() => setBusy(false));
  };
  return (
    <span className="flex shrink-0 gap-1">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("reject")}>
        Reject
      </Button>
      <Button size="sm" disabled={busy} onClick={() => run("accept")}>
        Accept
      </Button>
    </span>
  );
}

/** A source change as before → after (from / where / sql). */
function SourceDiff({ name, after }: { name: string; after: string }) {
  const before = useWorkspaceSelector((ws) => ws.snapshot().data[name]);
  return (
    <div className="mt-1 rounded-md bg-accent px-2 py-1.5 font-mono text-xs">
      <div className={cn("text-text-muted", before && "line-through")}>
        {before ? sourceSummary(before) : "new source"}
      </div>
      <div className="text-accent-foreground">{after}</div>
    </div>
  );
}

const STATUS: Record<ProposalChange["status"], string> = {
  pending: "",
  accepted: "accepted",
  rejected: "rejected",
  invalid: "no longer applies",
};

/** One change: its summary, a source diff for source changes, and Accept / Reject while pending. */
export function ChangeRow({ proposal, change }: { proposal: string; change: ProposalChange }) {
  const parsed = DashboardEditSchema.safeParse(change.op);
  const edit = parsed.success ? parsed.data : null;
  const pending = change.status === "pending";
  return (
    <div className="rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1", !pending && "text-text-muted")}>{change.summary}</span>
        {pending ? (
          <Decide proposal={proposal} index={change.index} />
        ) : (
          <span
            className={cn("shrink-0 text-sm", change.status === "invalid" ? "text-destructive" : "text-text-muted")}
          >
            {STATUS[change.status]}
          </span>
        )}
      </div>
      {change.reason && <div className="text-sm text-destructive">{change.reason}</div>}
      {pending && edit?.op === "set_data" && <SourceDiff name={edit.name} after={sourceSummary(edit.source)} />}
      {pending && edit?.op === "remove_data" && <SourceDiff name={edit.name} after="removed" />}
    </div>
  );
}

/** A view the harness proposes: dashed `--primary` outline, a placeholder body, and Accept / Reject. */
export function GhostTile({ element, item }: { element: DashboardElement; item: PendingChange }) {
  const component = COMPONENTS[element.type];
  const title =
    typeof element.props.title === "string" && element.props.title
      ? element.props.title
      : (component?.title ?? element.type);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 animate-nd-in flex-col overflow-hidden rounded-[7px] border-[1.5px] border-dashed border-primary bg-surface">
      <div className="flex h-(--tile-header) shrink-0 items-center px-2.5 text-ui text-text-muted">
        <span className="truncate">Proposed · {title}</span>
      </div>
      <div className="m-auto flex max-w-full flex-col items-center gap-0.5 px-3 text-center">
        <span className="font-medium">{component?.title ?? element.type}</span>
        {component?.description && (
          <span className="line-clamp-2 text-sm text-text-muted">{component.description}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 bg-accent px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-accent-foreground">Proposed by {item.agent}</span>
        <Decide proposal={item.proposal} index={item.change.index} />
      </div>
    </div>
  );
}

/** Bottom centre while changes are pending: who proposes how many, the non-tile changes, and the bulk decisions. */
export function ProposalBar() {
  const { harness, preview, review } = useProposals();
  const [busy, setBusy] = useState(false);
  const n = preview.pending.length;
  if (n === 0) return null;
  const agents = new Set(preview.pending.map((c) => c.agent));
  const who = agents.size === 1 ? [...agents][0] : "The harness";
  const all = (verdict: "accept" | "reject") => {
    setBusy(true);
    void decideAll(harness.state.proposals, verdict).finally(() => setBusy(false));
  };
  return (
    <div
      role="region"
      aria-label="Proposals"
      className={cn(
        popoverFrame,
        "absolute bottom-3 left-1/2 z-30 flex max-h-[45%] w-[min(440px,calc(100%-24px))] -translate-x-1/2 animate-nd-in flex-col",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 py-1 pr-1 pl-2">
        <span className="size-2 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {who} proposes {n} {n === 1 ? "change" : "changes"}
        </span>
        <Button size="sm" variant="ghost" onClick={review}>
          Review
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => all("reject")}>
          Reject all
        </Button>
        <Button size="sm" disabled={busy} onClick={() => all("accept")}>
          Accept all
        </Button>
      </div>
      {preview.review.length > 0 && (
        <div className="min-h-0 overflow-auto">
          {preview.review.map((item) => (
            <ChangeRow key={`${item.proposal}/${item.change.index}`} proposal={item.proposal} change={item.change} />
          ))}
        </div>
      )}
    </div>
  );
}
