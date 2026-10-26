/**
 * The json-render registry for the dashboard: layout components (`split`
 * with its resize sash, `stack`), tiles (`Tile.tsx`), and ghost-tile
 * dispatch: while the harness proposes new tiles, a proposed tile renders as
 * a ghost in place of its component.
 */

import type { ComponentRegistry, ComponentRenderProps } from "@json-render/react";
import { cn } from "@ndea/ui/lib/utils";
import { Children, use, useEffect, useRef, useState, type ReactNode } from "react";

import { ProposalsContext } from "@/core/proposals/harness";
import { GhostTile } from "@/core/proposals/Proposals";
import { ND_STAGE } from "./constants";
import { activeSpec, COMPONENTS, type Dashboard } from "./dashboard";
import { sashRatio } from "./split-geometry";
import { idOf, SlotTile, TabsTile, ViewTile } from "./Tile";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "./workspace-context";

/** The gutter between two panes is the resize handle; its hit area overhangs both tiles. */
function Sash({ horizontal, onPointerDown }: { horizontal: boolean; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "group relative z-[5] shrink-0 touch-none",
        horizontal ? "h-(--gutter) cursor-row-resize" : "w-(--gutter) cursor-col-resize",
      )}
    >
      <div
        className="absolute grid place-items-center"
        style={
          horizontal
            ? { left: 0, right: 0, top: "50%", height: ND_STAGE.sashHitPx, translate: "0 -50%" }
            : { top: 0, bottom: 0, left: "50%", width: ND_STAGE.sashHitPx, translate: "-50% 0" }
        }
      >
        <div className={cn("rounded-full group-hover:bg-primary/55", horizontal ? "h-0.5 w-9" : "h-9 w-0.5")} />
      </div>
    </div>
  );
}

function Pane({ share, children }: { share: number; children: ReactNode }) {
  return (
    <div
      className="flex"
      style={{ flex: `${share} 1 0%`, minWidth: ND_STAGE.minTilePx, minHeight: ND_STAGE.minTilePx }}
    >
      {children}
    </div>
  );
}

/**
 * Two panes and the sash between them. A sash drag previews the ratio locally
 * and commits one `set_props` when the pointer lets go, so a drag is one edit,
 * not one document copy per pointer move.
 */
function Split(props: ComponentRenderProps) {
  const ws = useWorkspace();
  const id = idOf(props);
  // A split a proposed tile opened exists only in the preview: no resizing until it is accepted.
  const real = useWorkspaceSelector((w) => w.element(id) !== undefined);
  const [preview, setPreview] = useState<number | null>(null);
  /** Removes the live sash drag's listeners; unmounting mid-drag commits nothing. */
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const horizontal = props.element.props.direction === "column";
  const ratio = preview ?? Number(props.element.props.ratio);
  const [first, second] = Children.toArray(props.children);

  const beginSash = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!box) return;
    stopDrag.current?.();
    let last: number | null = null;
    const move = (ev: PointerEvent) => {
      last = sashRatio(box, ev.clientX, ev.clientY, horizontal);
      setPreview(last);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopDrag.current = null;
    };
    const end = () => {
      stop();
      if (last !== null) applyOrToast(ws, [{ op: "set_props", id, props: { ratio: last } }]);
      setPreview(null);
    };
    stopDrag.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${horizontal ? "flex-col" : "flex-row"}`}>
      <Pane share={ratio}>{first}</Pane>
      <Sash horizontal={horizontal} onPointerDown={real ? beginSash : undefined} />
      <Pane share={1 - ratio}>{second}</Pane>
    </div>
  );
}

function Stack(props: ComponentRenderProps) {
  const column = props.element.props.direction === "column";
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 ${column ? "flex-col" : "flex-row"}`}
      style={{ gap: Number(props.element.props.gap ?? 4) }}
    >
      {Children.map(props.children, (child) => (
        <div className="flex min-h-0 min-w-0 flex-1">{child}</div>
      ))}
    </div>
  );
}

/** A tile the harness proposes renders as a ghost in place of the component. */
function ghostable(Component: (props: ComponentRenderProps) => ReactNode) {
  return function Ghostable(props: ComponentRenderProps) {
    const preview = use(ProposalsContext)?.preview;
    const id = idOf(props);
    const ghost = preview?.ghosts.get(id);
    const element = preview?.document && activeSpec(preview.document).elements[id];
    return ghost && element ? <GhostTile element={element} item={ghost} /> : <Component {...props} />;
  };
}

export const REGISTRY: ComponentRegistry = {
  split: Split,
  stack: Stack,
  slot: SlotTile,
  tabs: ghostable(TabsTile),
  ...Object.fromEntries(
    Object.entries(COMPONENTS)
      .filter(([, info]) => info.view)
      .map(([type]) => [type, ghostable(ViewTile)]),
  ),
};

/** A layout's spec plus each element's id as a render-only prop. */
export function renderSpec(spec: Dashboard) {
  return {
    root: spec.root,
    elements: Object.fromEntries(
      Object.entries(spec.elements).map(([id, element]) => [
        id,
        { ...element, props: { ...element.props, elementId: id } },
      ]),
    ),
  };
}
