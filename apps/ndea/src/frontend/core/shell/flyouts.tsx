/**
 * The rail's flyout bodies over real data: layouts (switch, add, rename, delete), collections
 * (the open one's datasets toggle the dataset filter; another switches) and
 * sources with exact obs counts, links (coordination scopes) and their member
 * views, the harness (agents, pending proposals, tool-call feed), and settings.
 */

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { setProvenanceBadges, useProvenanceBadges } from "@ndea/components/table";
import { Button } from "@ndea/ui/components/button";
import { IconButton } from "@ndea/ui/components/icon-button";
import { Input } from "@ndea/ui/components/input";
import { Switch } from "@ndea/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@ndea/ui/components/toggle-group";
import { cn } from "@ndea/ui/lib/utils";

import { isConnected, relativeTime, setHarnessMode, useProposals } from "@/core/proposals/harness";
import { agentOf, sourceSummary } from "@/core/proposals/preview";
import { ChangeRow } from "@/core/proposals/Proposals";
import { activeSpec, elementTitle, freshId, type Dashboard, type DashboardElement } from "@/core/workspace/dashboard";
import type { DashboardEdit } from "@/core/workspace/edits";
import { documentLinks } from "@/core/workspace/links";
import { LinkRow } from "@/core/workspace/LinksPopover";
import { dataSourceSql, type DataSources } from "@/core/workspace/data-sources";
import { useWorkspace, useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { useTheme } from "@/ThemeProvider";
import { LayoutWireframe } from "./LayoutWireframe";
import { obs, totalObs, useCollections } from "./collections";

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

/** Views of the tile tree in reading order (every tab of a tabs tile). */
function tiles(spec: Dashboard, id = spec.root): DashboardElement[] {
  const element = spec.elements[id];
  if (!element) return [];
  if (!["split", "stack", "tabs"].includes(element.type)) return [element];
  return element.children.flatMap((child) => tiles(spec, child));
}

const LAYOUT_ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted";

export function LayoutsFlyout() {
  const ws = useWorkspace();
  const layouts = useWorkspaceSelector((w) => w.snapshot().layouts);
  const current = useWorkspaceSelector((w) => w.snapshot().layout);
  const spec = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const name = layouts[current]?.name ?? current;
  const apply = (edits: DashboardEdit[]) => {
    try {
      ws.apply(edits);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  /** Add a layout (blank, or a copy of `from`) and show it. */
  const create = (layoutName: string, from?: string) => {
    const id = freshId("layout", new Set(Object.keys(layouts)));
    apply([
      { op: "add_layout", id, name: layoutName, from },
      { op: "set_active_layout", id },
    ]);
  };
  const rename = (value: string) => {
    setRenaming(null);
    if (value.trim() && value.trim() !== name) apply([{ op: "rename_layout", id: current, name: value.trim() }]);
  };
  const leaves = tiles(spec);
  return (
    <>
      <Heading>Layouts</Heading>
      {Object.entries(layouts).map(([id, layout]) =>
        id === current && renaming !== null ? (
          <Row key={id}>
            <LayoutWireframe spec={layout.spec} className="h-5 w-8 shrink-0" />
            <Input
              autoFocus
              aria-label="Layout name"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={() => rename(renaming)}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(renaming);
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(null);
                }
              }}
            />
          </Row>
        ) : (
          <button
            type="button"
            key={id}
            aria-current={id === current}
            className={LAYOUT_ROW}
            onClick={() => id !== current && apply([{ op: "set_active_layout", id }])}
          >
            <LayoutWireframe spec={layout.spec} className="h-5 w-8 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{layout.name}</span>
            {id === current && (
              <span className="flex shrink-0 items-center gap-1.5 text-sm text-text-muted">
                <span className="size-1.5 rounded-full bg-primary" />
                current
              </span>
            )}
          </button>
        ),
      )}
      <Heading>New from template</Heading>
      <button type="button" className={LAYOUT_ROW} onClick={() => create(`Layout ${Object.keys(layouts).length + 1}`)}>
        <PlusIcon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">Blank</span>
        <span className="text-sm text-text-muted">one empty tile</span>
      </button>
      {Object.entries(layouts).map(([id, layout]) => (
        <button type="button" key={id} className={LAYOUT_ROW} onClick={() => create(`${layout.name} copy`, id)}>
          <CopyIcon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">Copy of {layout.name}</span>
        </button>
      ))}
      <Heading>Current layout</Heading>
      {deleting ? (
        <Row>
          <span className="min-w-0 flex-1 truncate">Delete “{name}”?</span>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDeleting(false);
              apply([{ op: "remove_layout", id: current }]);
            }}
          >
            Delete
          </Button>
        </Row>
      ) : (
        <div className="flex flex-wrap gap-1 px-1">
          <Button size="sm" variant="ghost" onClick={() => create(`${name} copy`, current)}>
            <CopyIcon /> Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRenaming(name)}>
            <PencilIcon /> Rename
          </Button>
          {Object.keys(layouts).length > 1 && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon /> Delete
            </Button>
          )}
        </div>
      )}
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

function Collections() {
  const { collections, open, included, setIncluded, toggle, requestSwitch } = useCollections();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(open ? [open.name] : []));
  const flip = (name: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  return (
    <>
      <Heading>{collections.length === 1 ? "Collection" : "Collections"}</Heading>
      {collections.map((c) => {
        const isOpen = c === open;
        const filterable = isOpen && c.datasets.length > 1;
        return (
          <div key={c.name}>
            <Row className="items-start py-1 pl-0.5">
              <IconButton label={expanded.has(c.name) ? "Collapse" : "Expand"} onClick={() => flip(c.name)}>
                <ChevronRightIcon className={cn("transition-transform", expanded.has(c.name) && "rotate-90")} />
              </IconButton>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate font-mono text-xs text-text-muted tabular-nums">
                  {isOpen && "open · "}
                  {c.datasets.length} {c.datasets.length === 1 ? "dataset" : "datasets"} · {obs(totalObs(c))}
                </div>
              </div>
              {!isOpen && (
                <Button size="xs" variant="outline" onClick={() => requestSwitch(c.name)}>
                  Switch
                </Button>
              )}
            </Row>
            {expanded.has(c.name) &&
              c.datasets.map((d) => (
                <Row key={d.name} className="pl-8">
                  {filterable && (
                    <Switch
                      aria-label={`Include ${d.name}`}
                      checked={included === null || included.has(d.name)}
                      onCheckedChange={() => toggle(d.name)}
                    />
                  )}
                  <span
                    className={cn("min-w-0 flex-1 truncate font-mono text-ui-sm", !isOpen && "text-text-muted")}
                    title={d.name}
                  >
                    {d.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">{obs(d.nObs)}</span>
                </Row>
              ))}
            {filterable && included !== null && expanded.has(c.name) && (
              <Button size="xs" variant="link" className="ml-8" onClick={() => setIncluded(null)}>
                Include all datasets
              </Button>
            )}
          </div>
        );
      })}
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
  const summary = sourceSummary(source);
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
      <Collections />
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

export function SettingsFlyout() {
  const { theme, setTheme } = useTheme();
  const provenanceBadges = useProvenanceBadges();
  const { mode } = useProposals().harness.state;
  return (
    <>
      <Heading>Harness edits</Heading>
      <div className="px-2 py-1">
        <ToggleGroup
          variant="segmented"
          aria-label="Harness edits"
          value={[mode]}
          onValueChange={(value: string[]) => {
            if (value[0] === "propose" || value[0] === "direct") setHarnessMode(value[0]);
          }}
        >
          <ToggleGroupItem value="propose">Propose</ToggleGroupItem>
          <ToggleGroupItem value="direct">Apply directly</ToggleGroupItem>
        </ToggleGroup>
      </div>
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
      <Heading>Table</Heading>
      <label className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <span className="min-w-0 flex-1">Provenance badges</span>
        <Switch
          aria-label="Provenance badges"
          checked={provenanceBadges}
          onCheckedChange={(on) => setProvenanceBadges(on)}
        />
      </label>
      <Heading>MCP endpoint</Heading>
      <McpEndpoint />
    </>
  );
}
