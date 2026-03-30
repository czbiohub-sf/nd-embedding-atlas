/**
 * TerminalTable — ⌘J-toggled drawer that slides up from the status footer.
 *
 * Fixed position above the footer, slides in/out with CSS transition.
 * Drag handle at the top allows resizing the panel height.
 */

import { useCallback, useRef } from "react";
import { XIcon } from "lucide-react";
import { useTerminalTable } from "../../providers/TerminalTableProvider";
import { useDashboard } from "../../hooks/useDashboard";
import { DataTable } from "./DataTable";

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

export function TerminalTable() {
  const { open, height, toggle, setHeight } = useTerminalTable();
  const { state, actions, meta } = useDashboard();
  const { metadata, highlightId } = state;
  const { coordinator, brushSelection, table } = meta;

  // ── Drag-to-resize ──────────────────────────────────────────────────────
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(height);

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
      const delta = dragStartY.current - e.clientY; // dragging up = bigger
      setHeight(dragStartH.current + delta);
    },
    [setHeight],
  );

  const onDragEnd = useCallback(() => {
    dragStartY.current = null;
  }, []);

  return (
    <div
      className="fixed left-0 right-0 z-40 flex flex-col"
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
        className="shrink-0 h-1.5 w-full cursor-ns-resize select-none bg-border-subtle/30 hover:bg-border-subtle/60 transition-colors"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        aria-label="Resize table panel"
      />

      {/* Header bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-elevated px-3 py-1">
        <span className="text-[11px] font-medium text-text-secondary select-none">▲ Table</span>
        <span className="text-[10px] text-text-muted select-none" style={{ letterSpacing: "0.04em" }}>
          ⌘J
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={toggle}
          className="flex items-center justify-center rounded p-0.5 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close table"
        >
          <XIcon size={12} strokeWidth={2} />
        </button>
      </div>

      {/* DataTable — only render when open to avoid unnecessary queries */}
      {open && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DataTable
            coordinator={coordinator}
            table={table}
            columns={metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS}
            selection={brushSelection}
            highlightId={highlightId}
            onRowClick={(id) => actions.setHighlight(id)}
          />
        </div>
      )}
    </div>
  );
}
