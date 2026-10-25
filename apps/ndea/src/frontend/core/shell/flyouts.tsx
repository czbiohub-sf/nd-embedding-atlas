/**
 * The rail's flyout bodies, all read-only over real data: the current layout,
 * datasets and sources with exact obs counts, links (coordination scopes) and
 * their member views, harness presence, and settings.
 */

import { useQuery } from "@tanstack/react-query";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";

import { filterClauseSql } from "@ndea/components/filter";
import { IconButton } from "@ndea/ui/components/icon-button";
import { ToggleGroup, ToggleGroupItem } from "@ndea/ui/components/toggle-group";
import { cn } from "@ndea/ui/lib/utils";

import type { Dashboard, DashboardElement } from "@/core/workspace/dashboard";
import { documentLinks, elementTitle, LinkRow } from "@/core/workspace/LinksPopover";
import { dataSourceSql, type DataSources } from "@/core/workspace/data-sources";
import { useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { toRows } from "@/lib/mosaic-helpers";
import { useTheme } from "@/ThemeProvider";
import { LayoutWireframe } from "./LayoutWireframe";
import { isConnected, relativeTime, type HarnessAgent } from "./presence";

const obs = (n: number) => `${n.toLocaleString("en-US")} obs`;

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pt-3.5 pb-1 text-sm font-medium text-text-muted first:pt-1">{children}</div>;
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", className)}>{children}</div>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-text-muted">{children}</div>;
}

/* ── Layouts ───────────────────────────────────────────────────────── */

/** Leaves of the tile tree in reading order. */
function tiles(spec: Dashboard, id = spec.root): DashboardElement[] {
  const element = spec.elements[id];
  if (!element) return [];
  if (element.type !== "split" && element.type !== "stack") return [element];
  return element.children.flatMap((child) => tiles(spec, child));
}

export function LayoutsFlyout() {
  const spec = useWorkspaceSelector((ws) => ws.snapshot().spec);
  const leaves = tiles(spec);
  return (
    <>
      {/* ponytail: one layout until named layouts (G2) land. */}
      <Heading>Current layout</Heading>
      <div className="mx-2 mb-1 rounded-md bg-muted p-1.5">
        <LayoutWireframe spec={spec} className="aspect-[16/10] w-full" />
      </div>
      <Heading>Views</Heading>
      {leaves.map((element, index) =>
        element.type === "slot" ? (
          <Row key={index} className="text-text-muted">
            Empty tile
          </Row>
        ) : (
          <Row key={index}>
            <span className="min-w-0 flex-1 truncate">{elementTitle(element)}</span>
            <span className="font-mono text-xs text-text-muted">{element.type}</span>
          </Row>
        ),
      )}
    </>
  );
}

/* ── Data ──────────────────────────────────────────────────────────── */

function Count({ value, error }: { value: number | undefined; error: Error | null }) {
  if (error) return <span className="truncate text-destructive">{error.message}</span>;
  return (
    <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">
      {value === undefined ? "" : obs(value)}
    </span>
  );
}

function Datasets() {
  const { state, runtime } = useDatasetSession();
  const { coordinator, table } = runtime;
  const keys = state.metadata.dataset_keys ?? [];
  const names = keys.length > 0 ? keys : [table];
  const counts = useQuery({
    queryKey: ["shell", "dataset-counts", table, names],
    queryFn: async (): Promise<Record<string, number>> => {
      if (names.length === 1) {
        const [row] = toRows<{ n: number }>(await coordinator.query(`SELECT COUNT(*)::INT AS n FROM ${table}`));
        return { [names[0]]: row?.n ?? 0 };
      }
      const rows = toRows<{ name: unknown; n: number }>(
        await coordinator.query(`SELECT _dataset AS name, COUNT(*)::INT AS n FROM ${table} GROUP BY _dataset`),
      );
      return Object.fromEntries(rows.map((row) => [String(row.name), row.n]));
    },
  });
  return (
    <>
      <Heading>Datasets</Heading>
      {names.map((name) => (
        <Row key={name}>
          <span className="min-w-0 flex-1 truncate font-mono text-ui-sm font-medium">{name}</span>
          <Count value={counts.data?.[name]} error={counts.error} />
        </Row>
      ))}
    </>
  );
}

function Source({ name, data }: { name: string; data: DataSources }) {
  const source = data[name];
  const predicate = dataSourceSql(data, name);
  // ponytail: counts what the server holds; a source edited in this tab recounts once the edit's sync lands.
  const count = useQuery({
    queryKey: ["shell", "source-count", name, predicate],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/workspace/data/${encodeURIComponent(name)}`, { signal });
      const body = (await res.json()) as { count?: number; error?: string };
      if (!res.ok || body.count === undefined) throw new Error(body.error ?? `HTTP ${res.status}`);
      return body.count;
    },
  });
  const summary =
    [source.from && `from ${source.from}`, source.where && filterClauseSql(source.where), source.sql]
      .filter(Boolean)
      .join(" · ") || "every obs";
  return (
    <div className="rounded-md px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <Count value={count.data} error={count.error} />
      </div>
      <div className="truncate font-mono text-xs text-text-muted" title={summary}>
        {summary}
      </div>
    </div>
  );
}

export function DataFlyout() {
  const data = useWorkspaceSelector((ws) => ws.snapshot().data);
  const names = Object.keys(data);
  return (
    <>
      <Datasets />
      <Heading>Sources</Heading>
      {names.length === 0 ? (
        <Muted>No sources. Views read every obs.</Muted>
      ) : (
        names.map((name) => <Source key={name} name={name} data={data} />)
      )}
    </>
  );
}

/* ── Links ─────────────────────────────────────────────────────────── */

export function LinksFlyout() {
  const document = useWorkspaceSelector((ws) => ws.snapshot());
  const links = documentLinks(document);
  if (links.length === 0) return <Muted>No links. Views that share a link appear here.</Muted>;
  return links.map((link) => <LinkRow key={`${link.type}/${link.scope}`} document={document} link={link} />);
}

/* ── Harness and settings ──────────────────────────────────────────── */

function McpEndpoint() {
  const url = `${window.location.origin}/mcp`;
  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => toast("MCP endpoint copied", { description: url }),
      (error: unknown) => toast.error("Copy failed", { description: String(error) }),
    );
  return (
    <Row className="pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">{url}</span>
      <IconButton size="md" label="Copy MCP endpoint" onClick={() => void copy()}>
        <CopyIcon />
      </IconButton>
    </Row>
  );
}

export function HarnessFlyout({ agents, now }: { agents: readonly HarnessAgent[]; now: number }) {
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
      <Heading>MCP endpoint</Heading>
      <McpEndpoint />
    </>
  );
}

export function SettingsFlyout() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <Heading>Theme</Heading>
      <div className="px-2 py-1">
        <ToggleGroup
          variant="segmented"
          aria-label="Theme"
          value={[theme]}
          onValueChange={(value: string[]) => {
            if (value[0] === "dark" || value[0] === "light") setTheme(value[0]);
          }}
        >
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <Heading>MCP endpoint</Heading>
      <McpEndpoint />
    </>
  );
}
