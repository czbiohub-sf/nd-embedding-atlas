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
import type { FloatingWindowHandle } from "../hooks/useFloatingWindow";
import { cn } from "../lib/utils";

interface Props {
  handle: FloatingWindowHandle;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra icon buttons rendered left of the close button in the title bar */
  extraTitleActions?: ReactNode;
}

export function FloatingWindow({ handle, title, children, className, extraTitleActions }: Props) {
  const { state, close, dragHandleProps, resizeHandleProps } = handle;

  if (!state.open) return null;

  return (
    <div
      className={cn(
        "fixed z-[100] flex flex-col overflow-hidden",
        "rounded-xl border border-white/10 shadow-2xl shadow-black/60",
        "bg-card/90 backdrop-blur-xl",
        className,
      )}
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.minimized ? 36 : state.height,
        transition: state.minimized ? "height 150ms ease" : undefined,
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
          onPointerDown={(e) => e.stopPropagation()}
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
      {!state.minimized && <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>}

      {/* ── Resize handle (bottom-right corner) ── */}
      {!state.minimized && (
        <div
          className="absolute bottom-0 right-0 size-4 cursor-se-resize"
          {...resizeHandleProps}
          style={{ touchAction: "none" }}
        >
          {/* Subtle resize grip dots */}
          <svg viewBox="0 0 12 12" className="size-3 absolute bottom-1 right-1 text-white/20">
            <circle cx="9" cy="9" r="1.2" fill="currentColor" />
            <circle cx="5" cy="9" r="1.2" fill="currentColor" />
            <circle cx="9" cy="5" r="1.2" fill="currentColor" />
          </svg>
        </div>
      )}
    </div>
  );
}
