/**
 * Runtime status: one snapshot of what this server process is doing, shared
 * by `GET /api/status`, `ndea status`, and the in-process TUI. The client
 * counters are process-wide: one server per process.
 */

import type { RuntimeStatus } from "@ndea/protocol";
import { VERSION } from "../cli/version.ts";
import type { ServerSession } from "./state.ts";

const startedAt = new Date().toISOString();
const MAX_AGENTS = 32;
const agents = new Map<string, string>();

/** Mutated by `ws.ts` (open sockets) and the `/mcp` wrapper (requests in flight). */
export const clients = { browserSockets: 0, mcpInFlight: 0 };

/** Record an `X-Ndea-Agent` sighting; keeps the most recent 32 agents. */
export function agentSeen(agent: string): void {
  agents.delete(agent);
  agents.set(agent, new Date().toISOString());
  if (agents.size > MAX_AGENTS) agents.delete(agents.keys().next().value!);
}

export function getRuntimeStatus(session: ServerSession, url: string): RuntimeStatus {
  const { workspace } = session;
  return {
    server: { version: VERSION, url, startedAt, rss: process.memoryUsage.rss() },
    datasets: [...session.datasets].map(([name, { path }]) => {
      const handle = session.accessors.get(name);
      return {
        name,
        path,
        observations: handle?.nObs ?? 0,
        variables: handle && "nVars" in handle ? (handle.nVars as number) : undefined,
      };
    }),
    embeddings: {
      available: session.availableObsmKeys,
      loading: [...session.loadingTasks.keys()].filter(
        (key) => !session.obsmLoaders.has(key) && !session.loadErrors.has(key),
      ),
      errors: Object.fromEntries(session.loadErrors),
    },
    workspace: { path: workspace.path, revision: workspace.get().revision, last: workspace.history({ limit: 1 })[0] },
    clients: {
      ...clients,
      agents: [...agents].toReversed().map(([agent, lastSeen]) => ({ agent, lastSeen })),
    },
  };
}
