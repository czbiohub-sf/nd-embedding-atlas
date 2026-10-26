/**
 * The Data flyout: collections (the open one's datasets toggle the dataset
 * filter; another switches) and the workspace's sources with exact obs counts.
 */

import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@ndea/ui/components/button";
import { IconButton } from "@ndea/ui/components/icon-button";
import { Switch } from "@ndea/ui/components/switch";
import { cn } from "@ndea/ui/lib/utils";

import { sourceSummary } from "@/core/proposals/preview";
import { dataSourceSql, type DataSources } from "@/core/workspace/data-sources";
import { useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { obs, requestSwitch, totalObs, useCollections } from "./collections";
import { Heading, Muted, Row } from "./flyout-rows";

function Count({ value, error }: { value: number | undefined; error: Error | null }) {
  if (error) return <span className="truncate text-destructive">{error.message}</span>;
  return (
    <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">
      {value === undefined ? "" : obs(value)}
    </span>
  );
}

function Collections() {
  const { collections, open, included, setIncluded, toggle } = useCollections();
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
