/**
 * Harness presence: the agents the server has seen over MCP (`X-Ndea-Agent`),
 * pushed over `harness/watch`. An agent counts as connected while its last
 * MCP request is recent; MCP is stateless HTTP, so there is no disconnect.
 */

import type { HarnessPresence } from "@ndea/protocol";
import { useEffect, useState } from "react";

import { wsClient } from "@/lib/ws-client";

// ponytail: fixed window over the last MCP request; a server-side session or heartbeat would make it exact.
export const HARNESS_CONNECTED_MS = 5 * 60_000;

export type HarnessAgent = HarnessPresence["agents"][number];

/** Every agent seen, most recent first, and a clock that ticks every 30s so `connected` and times stay current. */
export function useHarnessPresence(): { agents: readonly HarnessAgent[]; now: number } {
  const [agents, setAgents] = useState<readonly HarnessAgent[]>([]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let sub: { unsubscribe(): void };
    // The socket reconnects on its own; subscribe again after a drop.
    const open = () => {
      sub = wsClient.subscribe(
        "harness/watch",
        {},
        (presence) => {
          setAgents(presence.agents);
          setNow(Date.now());
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
  return { agents, now };
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
