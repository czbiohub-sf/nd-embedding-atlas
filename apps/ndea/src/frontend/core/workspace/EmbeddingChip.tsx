/**
 * The embedding chip in an embedding view's tile header: shows the view's obsm
 * key and switches it from a filterable list (each entry with its dimension
 * count and the views that already show it). A switch resets the axes, so the
 * body restarts on the new embedding at x = 0, y = 1, 2D.
 */

import { Input } from "@ndea/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger, popoverHeading, popoverRow } from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { useDatasetSession } from "@/hooks/useDatasetSession";
import { activeSpec, elementTitle } from "./dashboard";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "./workspace-context";

type Obsm = Record<string, { loaded: boolean; n_dims?: number | null }>;

/** The key an embedding view shows: its `obsmKey`, else the scatter's default (first loaded, else first). */
function effectiveObsmKey(obsmKey: unknown, obsm: Obsm): string | undefined {
  if (typeof obsmKey === "string" && obsm[obsmKey]) return obsmKey;
  return Object.entries(obsm).find(([, entry]) => entry.loaded)?.[0] ?? Object.keys(obsm)[0];
}

export function EmbeddingChip({ id }: { id: string }) {
  const ws = useWorkspace();
  const { state } = useDatasetSession();
  const obsm: Obsm = state.metadata.obsm;
  const elements = useWorkspaceSelector((w) => activeSpec(w.snapshot()).elements);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const current = effectiveObsmKey(elements[id]?.props.obsmKey, obsm);
  if (!current) return null;

  const usedBy = (key: string) =>
    Object.values(elements)
      .filter((element) => element.type === "scatter" && effectiveObsmKey(element.props.obsmKey, obsm) === key)
      .map(elementTitle);
  const keys = Object.keys(obsm).filter((key) => key.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        className="min-w-0 truncate rounded-sm bg-muted px-2 py-0.5 font-mono text-sm text-muted-foreground hover:text-foreground data-popup-open:bg-accent data-popup-open:text-accent-foreground"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {current}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--popover-width)">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter embeddings" />
        <div className={popoverHeading}>Embeddings</div>
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {keys.map((key) => {
            const users = usedBy(key);
            return (
              <button
                type="button"
                key={key}
                className={cn(popoverRow, "w-full text-left hover:bg-muted")}
                onClick={() => {
                  if (key !== current) {
                    applyOrToast(ws, [{ op: "set_props", id, props: { obsmKey: key, xDim: 0, yDim: 1, zDim: null } }]);
                  }
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-foreground">{key}</span>
                  <span className="truncate text-sm text-text-muted">
                    {obsm[key].n_dims == null ? "not loaded" : `${obsm[key].n_dims} dims`}
                  </span>
                </span>
                {users.length > 0 ? (
                  <span className="max-w-28 truncate text-sm text-primary">{users.join(", ")}</span>
                ) : null}
                {key === current ? <CheckIcon className="text-primary" /> : null}
              </button>
            );
          })}
          {keys.length === 0 ? <div className="px-2 py-1.5 text-sm text-text-muted">No embedding matches.</div> : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
