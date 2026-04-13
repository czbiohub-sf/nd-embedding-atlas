/**
 * TerminalTable — ⌘J-toggled drawer above the status footer.
 * Tabs: Table | Track
 */

import { XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { DataTable } from "./DataTable";
import { useTerminalTable } from "./TerminalTableProvider";
import { TrackPane } from "./TrackPane";

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TerminalTable() {
  const { open, height, toggle, setHeight } = useTerminalTable();
  const [totalCount, setTotalCount] = useState(0);
  const { state, actions, meta } = useDashboard();
  const { metadata, highlightId, trajectories } = state;
  const hasAnyTrajectory = Object.keys(trajectories).length > 0;
  const { coordinator, brushSelection, table } = meta;

  // ── Drag-to-resize ───────────────────────────────────────────────────────
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef(height);

  const onDragStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartY.current = e.clientY;
      dragStartH.current = height;
    },
    [height],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragStartY.current === null) return;
      setHeight(dragStartH.current + (dragStartY.current - e.clientY));
    },
    [setHeight],
  );

  const onDragEnd = useCallback(() => {
    dragStartY.current = null;
  }, []);

  return (
    <div
      className="fixed right-0 left-0 z-40 flex flex-col"
      style={{
        bottom: "var(--footer-height, 1.5rem)",
        height: open ? height : 0,
        transition: "height 200ms ease",
        overflow: "hidden",
        borderTop: open ? "1px solid var(--color-border-subtle)" : "none",
        background: "var(--color-surface)",
      }}
    >
      {/* Drag handle */}
      <div
        className="h-1.5 w-full shrink-0 cursor-ns-resize select-none bg-border-subtle/30 transition-colors hover:bg-border-subtle/60"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="Resize table panel"
      />

      {open && (
        <Tabs defaultValue="table" className="flex min-h-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex shrink-0 items-center border-border-subtle border-b bg-elevated">
            <TabsList className="border-b-0 px-1">
              <TabsTrigger value="table">
                Table
                {totalCount > 0 && (
                  <span className="ml-1.5 text-[9px] text-muted-foreground/50 tabular-nums">
                    {totalCount.toLocaleString()}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="track">
                Track
                {hasAnyTrajectory && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-primary/70" />}
              </TabsTrigger>
            </TabsList>
            <span className="flex-1" />
            <button
              type="button"
              onClick={toggle}
              className="mr-2 flex items-center justify-center rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
              aria-label="Close table"
            >
              <XIcon size={12} strokeWidth={2} />
            </button>
          </div>

          <TabsContent value="table" className="flex flex-col overflow-hidden">
            <DataTable
              coordinator={coordinator}
              table={table}
              columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
              selection={brushSelection}
              highlightId={highlightId}
              onRowClick={(id) => actions.setHighlight(id)}
              onTotalCountChange={setTotalCount}
            />
          </TabsContent>

          <TabsContent value="track" className="flex flex-col overflow-hidden">
            <TrackPane />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
