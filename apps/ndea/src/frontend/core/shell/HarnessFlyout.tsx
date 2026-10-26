/** The Harness flyout: agents seen, pending proposals (each change decidable), the tool-call feed, the MCP endpoint. */

import { cn } from "@ndea/ui/lib/utils";

import { isConnected, relativeTime, useProposals } from "@/core/proposals/harness";
import { agentOf } from "@/core/proposals/preview";
import { ChangeRow } from "@/core/proposals/Proposals";
import { Heading, McpEndpoint, Muted, Row } from "./flyout-rows";

export function HarnessFlyout() {
  const { harness } = useProposals();
  const { agents, proposals, feed } = harness.state;
  const { now } = harness;
  return (
    <>
      <Heading>Agents</Heading>
      {agents.length === 0 ? (
        <Muted>
          No harness has connected. Run <span className="font-mono text-foreground">ndea mcp install</span> to add ndea
          to your coding agents.
        </Muted>
      ) : (
        agents.map((agent) => {
          const connected = isConnected(agent, now);
          return (
            <Row key={agent.agent}>
              <span className={cn("size-[7px] shrink-0 rounded-full", connected ? "bg-success" : "bg-text-faint")} />
              <span className="min-w-0 flex-1 truncate font-medium">{agent.agent}</span>
              <span className={cn("shrink-0 text-sm", connected ? "text-success" : "text-text-muted")}>
                {connected ? "connected" : `seen ${relativeTime(agent.lastSeen, now)}`}
              </span>
            </Row>
          );
        })
      )}
      {proposals.length > 0 && <Heading>Proposals</Heading>}
      {proposals.map((proposal) => (
        <div key={proposal.id} className="mb-1 rounded-md bg-muted/50">
          <div className="px-2 pt-1.5 text-sm text-text-muted">
            {agentOf(proposal)} · {relativeTime(proposal.createdAt, now)}
          </div>
          {proposal.changes.map((change) => (
            <ChangeRow key={change.index} proposal={proposal.id} change={change} />
          ))}
        </div>
      ))}
      <Heading>Tool calls</Heading>
      {feed.length === 0 ? (
        <Muted>No tool calls yet.</Muted>
      ) : (
        feed.map((call, index) => (
          <div
            key={`${call.at}/${index}`}
            className="grid grid-cols-[34px_minmax(0,1fr)] gap-x-2 gap-y-px rounded-md px-2 py-1.5 hover:bg-muted"
          >
            <span className="font-mono text-xs text-text-muted tabular-nums">
              {new Date(call.at).toTimeString().slice(0, 5)}
            </span>
            <span className="min-w-0 wrap-anywhere">
              <span className={cn("font-mono font-medium", call.write && "text-primary")}>{call.tool}</span>{" "}
              <span className="text-text-muted">{call.summary}</span>
            </span>
            <span />
            <span className="font-mono text-xs wrap-anywhere text-text-muted">{call.outcome}</span>
          </div>
        ))
      )}
      <Heading>MCP endpoint</Heading>
      <McpEndpoint />
    </>
  );
}
