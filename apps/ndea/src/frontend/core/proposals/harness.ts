/**
 * The harness as the browser sees it, pushed over `harness/watch`: agents seen
 * over MCP (`X-Ndea-Agent`), the edit mode, pending proposals, and the
 * tool-call feed. A `rejected` push (an invalid harness edit) shows once as a
 * toast and bumps `shake` so the Harness rail button shakes. Accept and reject
 * go over REST; the document then updates through `workspace/watch`.
 */

import type { HarnessMode, HarnessState, Proposal, ProposalAccepted, ProposalRejected } from "@ndea/protocol";
import { createContext, use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { wsClient } from "@/lib/ws-client";
import type { ProposalPreview } from "./preview";

// ponytail: fixed window over the last MCP request; a server-side session or heartbeat would make it exact.
const HARNESS_CONNECTED_MS = 5 * 60_000;

export type HarnessAgent = HarnessState["agents"][number];

const EMPTY: HarnessState = { agents: [], mode: "propose", proposals: [], feed: [] };

export interface Harness {
  state: HarnessState;
  /** A clock that ticks every 30s so `connected` and relative times stay current. */
  now: number;
  /** Bumped on every rejected harness edit. */
  shake: number;
}

/** What the shell shares with the grid, the proposal bar, and the flyouts. */
export interface Proposals {
  harness: Harness;
  preview: ProposalPreview;
  /** Open the Harness flyout pinned. */
  review: () => void;
}

export const ProposalsContext = createContext<Proposals | null>(null);

export function useProposals(): Proposals {
  const value = use(ProposalsContext);
  if (!value) throw new Error("proposal UI renders inside the shell");
  return value;
}

export function useHarness(): Harness {
  const [state, setState] = useState(EMPTY);
  const [now, setNow] = useState(Date.now);
  const [shake, setShake] = useState(0);
  useEffect(() => {
    let sub: { unsubscribe(): void };
    // The socket reconnects on its own; subscribe again after a drop.
    const open = () => {
      sub = wsClient.subscribe(
        "harness/watch",
        {},
        (event) => {
          setNow(Date.now());
          if (event.kind === "state") return setState(event.state);
          const issue = event.issues[0];
          toast.error(`Edit from ${event.agent ?? "the harness"} rejected`, {
            description: issue ? `${event.reason} · ${issue.pointer}: ${issue.detail}` : event.reason,
          });
          setShake((n) => n + 1);
        },
        open,
      );
    };
    open();
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      sub.unsubscribe();
    };
  }, []);
  return useMemo(() => ({ state, now, shake }), [state, now, shake]);
}

async function send<T>(method: string, path: string, body: unknown): Promise<T | null> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.ok) return json;
  toast.error("Harness request failed", { description: json.error ?? `HTTP ${res.status}` });
  return null;
}

export function setHarnessMode(mode: HarnessMode): void {
  void send("PUT", "/api/harness/mode", { mode });
}

/** Accept or reject a proposal's changes (all pending ones when `changes` is omitted). */
export async function decide(proposal: string, verdict: "accept" | "reject", changes?: number[]): Promise<void> {
  const res = await send<ProposalAccepted | ProposalRejected>(
    "POST",
    `/api/proposals/${encodeURIComponent(proposal)}/${verdict}`,
    changes ? { changes } : {},
  );
  // A change that no longer applies to the current workspace is marked invalid with its reason.
  const invalid = res?.proposal?.changes.filter(
    (c) => c.status === "invalid" && (changes === undefined || changes.includes(c.index)),
  );
  for (const change of invalid ?? [])
    toast.error("Change no longer applies", { description: `${change.summary}: ${change.reason}` });
}

/** Decide every proposal's pending changes, oldest proposal first. */
export async function decideAll(proposals: readonly Proposal[], verdict: "accept" | "reject"): Promise<void> {
  for (const proposal of proposals) await decide(proposal.id, verdict);
}

export function isConnected(agent: HarnessAgent, now: number): boolean {
  return now - Date.parse(agent.lastSeen) < HARNESS_CONNECTED_MS;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

export function relativeTime(iso: string, now: number): string {
  // A time stamped after the caller's last clock tick reads as "now", never "in 2s".
  const delta = Math.min(0, Date.parse(iso) - now);
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms || unit === "second") return relative.format(Math.round(delta / ms), unit);
  }
  return "";
}
