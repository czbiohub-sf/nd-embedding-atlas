/**
 * Links in the tile header: the indicator (one dot per link the view joins),
 * its popover, and `LinkRow`, the one row the popover and the Links flyout
 * share. Hovering a row rings its member tiles; Unlink is the `unbind` edit.
 */

import { NdScopesIcon } from "@ndea/ui/components/nd-icons";
import { Popover, PopoverContent, PopoverTrigger, popoverHeading, popoverSeparator } from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";
import { createContext, use, useState } from "react";

import { COORDINATION_TYPE_IDS, type CoordinationState, type CoordinationTypeId } from "@/core/coordination/types";
import { allElements, COMPONENTS, elementScope, findElement, type DashboardElement } from "./dashboard";
import type { WorkspaceDocument } from "./types";
import { useWorkspace, useWorkspaceSelector } from "./workspace-context";

/** Opens the Links rail flyout; the shell provides it. */
export const OpenLinksContext = createContext<() => void>(() => {});

export const LINK_DOT: Record<CoordinationTypeId, string> = {
  filter: "bg-scope-filter",
  focus: "bg-scope-focus",
  colorBy: "bg-scope-color",
  viewSync: "bg-text-muted",
  ordering: "bg-text-muted",
};

export const LINK_LABEL: Record<CoordinationTypeId, string> = {
  filter: "Filter",
  focus: "Focus",
  colorBy: "Color by",
  viewSync: "View sync",
  ordering: "Sort",
};

/** What the link currently holds, in one phrase. */
function linkValue(state: CoordinationState, type: CoordinationTypeId, scope: string): string {
  switch (type) {
    case "filter": {
      const sources = Object.values(state.filter?.[scope] ?? {});
      const clauses = sources.reduce((sum, facets) => sum + Object.keys(facets).length, 0);
      return clauses === 0 ? "No selection" : clauses === 1 ? "1 clause" : `${clauses} clauses`;
    }
    case "focus": {
      const index = state.focus?.[scope];
      return index === null || index === undefined ? "Nothing focused" : `obs ${index.toLocaleString("en-US")}`;
    }
    case "colorBy":
      return state.colorBy?.[scope] ?? "No color";
    case "viewSync": {
      const zoom = state.viewSync?.[scope]?.zoom;
      return zoom === undefined ? "Not moved" : `Zoom ${zoom.toFixed(2)}`;
    }
    case "ordering": {
      const order = state.ordering?.[scope];
      return order ? `${order.col} ${order.dir}` : "Unsorted";
    }
  }
}

export const elementTitle = (element: DashboardElement): string => {
  const { title } = element.props;
  return typeof title === "string" && title ? title : (COMPONENTS[element.type]?.title ?? element.type);
};

export interface Link {
  type: CoordinationTypeId;
  scope: string;
}

/** Every link in the document, or only those `id` joins. */
export function documentLinks(document: WorkspaceDocument, id?: string): Link[] {
  return COORDINATION_TYPE_IDS.flatMap((type) => {
    if (id === undefined) return Object.keys(document.state[type] ?? {}).map((scope) => ({ type, scope }));
    const scope = elementScope(findElement(document, id), type);
    return scope === undefined ? [] : [{ type, scope }];
  });
}

const UNLINK = "rounded-sm px-1.5 py-0.5 text-sm text-text-muted hover:bg-accent hover:text-foreground";

/**
 * One link: dot, type and name, value, members (in every layout). `unlink`
 * set: one Unlink for that view (popover); unset: Unlink per member (flyout).
 */
export function LinkRow({ document, link, unlink }: { document: WorkspaceDocument; link: Link; unlink?: string }) {
  const ws = useWorkspace();
  const { type, scope } = link;
  const members = allElements(document).filter(([, element]) => elementScope(element, type) === scope);
  const unbind = (id: string) => {
    ws.highlight([]);
    ws.apply([{ op: "unbind", id, type }]);
  };
  return (
    <div
      onMouseEnter={() => ws.highlight(members.map(([id]) => id))}
      onMouseLeave={() => ws.highlight([])}
      className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-lg px-1.5 py-[7px] hover:bg-muted"
    >
      <span className={cn("size-2 rounded-full", LINK_DOT[type])} />
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-medium">{LINK_LABEL[type]}</span>
        <span className="truncate font-mono text-xs text-text-muted">{scope}</span>
      </span>
      {unlink !== undefined ? (
        <button type="button" className={UNLINK} onClick={() => unbind(unlink)}>
          Unlink
        </button>
      ) : (
        <span />
      )}
      <span className="col-span-2 col-start-2 truncate font-mono text-sm">
        {linkValue(document.state, type, scope)}
      </span>
      <span className="col-span-2 col-start-2 text-sm leading-[1.4] text-text-muted">
        {members.length === 0
          ? "No member views"
          : unlink !== undefined
            ? members.map(([, element]) => elementTitle(element)).join(", ")
            : members.map(([id, element]) => (
                <span key={id} className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">{elementTitle(element)}</span>
                  <button type="button" className={UNLINK} onClick={() => unbind(id)}>
                    Unlink
                  </button>
                </span>
              ))}
      </span>
    </div>
  );
}

/** The header's link indicator and its popover. */
export function LinksIndicator({ id }: { id: string }) {
  const ws = useWorkspace();
  const openLinks = use(OpenLinksContext);
  const [open, setOpen] = useState(false);
  const document = useWorkspaceSelector((w) => w.snapshot());
  const element = findElement(document, id);
  if (!element) return null;
  const links = documentLinks(document, id);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) ws.highlight([]);
      }}
    >
      <PopoverTrigger
        title={links.length === 0 ? "Not linked" : `Linked: ${links.map((l) => l.scope).join(", ")}`}
        aria-label="Links"
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-[3px] rounded-sm px-1 py-[3px] text-text-muted hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <NdScopesIcon className="size-[13px]" />
        {links.length > 0 && (
          <span className="flex gap-0.5">
            {links.map(({ type }) => (
              <span key={type} className={cn("size-1 rounded-full", LINK_DOT[type])} />
            ))}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0">
        <div className={popoverHeading}>
          Linked scopes <span className="text-foreground">{elementTitle(element)}</span>
        </div>
        {links.length === 0 ? (
          <div className="px-2 py-1.5 text-text-muted">Not linked. Link it from view settings.</div>
        ) : (
          links.map((link) => <LinkRow key={link.type} document={document} link={link} unlink={id} />)
        )}
        <div className={popoverSeparator} />
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-left text-text-muted hover:bg-muted hover:text-foreground"
          onClick={() => {
            setOpen(false);
            ws.highlight([]);
            openLinks();
          }}
        >
          Manage all scopes
        </button>
      </PopoverContent>
    </Popover>
  );
}
