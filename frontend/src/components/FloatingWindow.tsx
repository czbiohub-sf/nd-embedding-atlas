/**
 * FloatingWindow — in-app draggable, resizable floating panel.
 *
 * Works with useFloatingWindow() hook. Any content can be floated — scatter,
 * table, image viewer, etc.
 *
 * Usage:
 *   const fw = useFloatingWindow({ initialWidth: 480, initialHeight: 480 });
 *   <FloatingWindow handle={fw} title="X_umap">{content}</FloatingWindow>
 */

import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { FloatingWindowHandle, ResizeEdge } from "../hooks/useFloatingWindow";
import { cn } from "../lib/utils";

interface Props {
  handle: FloatingWindowHandle;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra icon buttons rendered left of the close button in the title bar */
  extraTitleActions?: ReactNode;
}

// ── Resize handle descriptors ─────────────────────────────────────────────────

const EDGE_HANDLES: Array<{
  edge: ResizeEdge;
  className: string;
  cursor: string;
}> = [
  // Corners
  { edge: "nw", className: "top-0 left-0 size-3", cursor: "cursor-nw-resize" },
  { edge: "ne", className: "top-0 right-0 size-3", cursor: "cursor-ne-resize" },
  { edge: "sw", className: "bottom-0 left-0 size-3", cursor: "cursor-sw-resize" },
  { edge: "se", className: "bottom-0 right-0 size-3", cursor: "cursor-se-resize" },
  // Edges
  { edge: "n", className: "top-0 left-3 right-3 h-1.5", cursor: "cursor-n-resize" },
  { edge: "s", className: "bottom-0 left-3 right-3 h-1.5", cursor: "cursor-s-resize" },
  { edge: "w", className: "left-0 top-3 bottom-3 w-1.5", cursor: "cursor-w-resize" },
  { edge: "e", className: "right-0 top-3 bottom-3 w-1.5", cursor: "cursor-e-resize" },
];

export function FloatingWindow({ handle, title, children, className, extraTitleActions }: Props) {
  const { state, close, dragHandleProps, getResizeProps } = handle;

  if (!state.open) return null;

  return (
    <div
      className={cn(
        "fixed z-float flex flex-col overflow-hidden",
        "rounded-xl border border-white/[0.07] shadow-2xl shadow-black/60",
        "bg-card/80 backdrop-blur-md",
        className,
      )}
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
      }}
    >
      {/* ── Title bar — drag handle ── */}
      <div
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-white/[0.07] px-3 select-none active:cursor-grabbing"
        {...dragHandleProps}
      >
        {title && <span className="flex-1 truncate text-[11px] font-medium text-muted-foreground/60">{title}</span>}
        {extraTitleActions}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
          className="flex size-4 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:text-muted-foreground"
          aria-label="Close"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* ── Content ── */}
      <div
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        style={state.minimized ? { visibility: "hidden", pointerEvents: "none" } : undefined}
      >
        {children}
      </div>

      {/* ── Resize handles — all 4 corners + 4 edges ── */}
      {!state.minimized &&
        EDGE_HANDLES.map(({ edge, className, cursor }) => (
          <div
            key={edge}
            className={cn("absolute z-10", cursor, className)}
            {...getResizeProps(edge)}
            style={{ touchAction: "none" }}
          />
        ))}

      {/* Subtle grip dots at bottom-right corner */}
      {!state.minimized && (
        <svg viewBox="0 0 12 12" className="pointer-events-none absolute bottom-1 right-1 z-10 size-3 text-white/20">
          <circle cx="9" cy="9" r="1.2" fill="currentColor" />
          <circle cx="5" cy="9" r="1.2" fill="currentColor" />
          <circle cx="9" cy="5" r="1.2" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}
