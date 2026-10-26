/** The Layouts flyout: switch, add (blank or a copy), duplicate, rename, and delete layouts; the current layout's views. */

import { CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@ndea/ui/components/button";
import { Input } from "@ndea/ui/components/input";

import { activeSpec, elementTitle, freshId, layoutTiles } from "@/core/workspace/dashboard";
import type { DashboardEdit } from "@/core/workspace/edits";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "@/core/workspace/workspace-context";
import { Heading, Row } from "./flyout-rows";
import { LayoutWireframe } from "./LayoutWireframe";

const LAYOUT_ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted";

export function LayoutsFlyout() {
  const ws = useWorkspace();
  const layouts = useWorkspaceSelector((w) => w.snapshot().layouts);
  const current = useWorkspaceSelector((w) => w.snapshot().layout);
  const spec = useWorkspaceSelector((w) => activeSpec(w.snapshot()));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const name = layouts[current]?.name ?? current;
  const apply = (edits: DashboardEdit[]) => applyOrToast(ws, edits);
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
  // Every view in reading order: each tab of a tabs tile.
  const views = layoutTiles(spec).flatMap((id) =>
    spec.elements[id].type === "tabs" ? spec.elements[id].children : [id],
  );
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
        <PlusIcon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">Blank</span>
        <span className="text-sm text-text-muted">one empty tile</span>
      </button>
      {Object.entries(layouts).map(([id, layout]) => (
        <button type="button" key={id} className={LAYOUT_ROW} onClick={() => create(`${layout.name} copy`, id)}>
          <CopyIcon className="size-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
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
      {views.map((id) => {
        const element = spec.elements[id];
        return element.type === "slot" ? (
          <Row key={id} className="text-text-muted">
            Empty tile
          </Row>
        ) : (
          <Row key={id}>
            <span className="min-w-0 flex-1 truncate">{elementTitle(element)}</span>
            <span className="font-mono text-xs text-text-muted">{element.type}</span>
          </Row>
        );
      })}
    </>
  );
}
