"use client";

import type { LucideIcon } from "lucide-react";
import { XIcon } from "lucide-react";
import { createContext, useContext } from "react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { type PanelSide, usePanel } from "@/stores/panelRegistry";
import { BracketIcon } from "./bracket-icon";
import { Button } from "./button";
import { SheetClose, SheetContent, SheetTitle, Sheet as SheetRoot } from "./sheet";

/**
 * SlidePanel — one floating-card panel primitive on the Base-UI Sheet, driven by
 * the panel registry (open/size/side, per-session). Collections (side=right) and
 * Table/Devtools (side=bottom) all render through it.
 *
 *   <SlidePanel id="collections">
 *     <SlidePanel.Content>
 *       <SlidePanel.Header icon={Bookmark} title="Collections" />
 *       <SlidePanel.Body>{…}</SlidePanel.Body>
 *     </SlidePanel.Content>
 *   </SlidePanel>
 *
 * Side=bottom renders a wide card inset above var(--footer-height); side=right a
 * resizable column. Size comes from the registry; ResizeHandle drags it.
 */

interface SlidePanelCtx {
  side: PanelSide;
  size: number;
  setSize: (px: number) => void;
}
const Ctx = createContext<SlidePanelCtx | null>(null);
function useSlidePanel(): SlidePanelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("SlidePanel subcomponents must be used inside <SlidePanel>");
  return c;
}

function SlidePanelRoot({ id, children }: { id: string; children: React.ReactNode }) {
  const { open, setOpen, side, size, setSize } = usePanel(id);
  return (
    <SheetRoot open={open} onOpenChange={setOpen}>
      <Ctx.Provider value={{ side, size, setSize }}>{children}</Ctx.Provider>
    </SheetRoot>
  );
}

function Content({ className, children }: { className?: string; children: React.ReactNode }) {
  const { side, size } = useSlidePanel();
  // Inline style wins over the Sheet's utility classes — clean override for the
  // resizable size + the wide-bottom-above-footer placement.
  const style: React.CSSProperties =
    side === "bottom"
      ? {
          height: size,
          left: "0.75rem",
          right: "0.75rem",
          bottom: "calc(var(--footer-height) + 0.25rem)",
          width: "auto",
          maxHeight: "none",
          transform: "none",
        }
      : { width: size };
  return (
    <SheetContent
      side={side}
      showCloseButton={false}
      style={style}
      className={cn("gap-0 overflow-hidden p-0", className)}
    >
      {children}
    </SheetContent>
  );
}

function Header({
  icon,
  title,
  className,
  children,
}: {
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2.5 border-border border-b px-3 py-2", className)}>
      {icon && <BracketIcon icon={icon} className="size-6 text-primary" />}
      {title && <SheetTitle>{title}</SheetTitle>}
      {children}
      <SheetClose
        render={<Button variant="ghost" size="icon-sm" className="ml-auto size-6 shrink-0" />}
        aria-label="Close panel"
      >
        <XIcon className="size-3.5" />
      </SheetClose>
    </div>
  );
}

function Body({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("min-h-0 flex-1 overflow-auto", className)}>{children}</div>;
}

function Footer({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-border border-t px-3 py-1.5 font-mono text-3xs text-muted-foreground/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Drag-to-resize edge. Top edge for side=bottom, left edge for side=right. */
function ResizeHandle() {
  const { side, size, setSize } = useSlidePanel();
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = side === "bottom" ? e.clientY : e.clientX;
    const startSize = size;
    const onMove = (ev: PointerEvent) => {
      const pos = side === "bottom" ? ev.clientY : ev.clientX;
      setSize(startSize + (start - pos)); // drag toward the canvas (up / left) grows the panel
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={side === "bottom" ? "horizontal" : "vertical"}
      className={cn(
        "absolute z-10 touch-none select-none transition-colors hover:bg-primary/30",
        side === "bottom" ? "inset-x-0 top-0 h-1.5 cursor-ns-resize" : "inset-y-0 left-0 w-1.5 cursor-ew-resize",
      )}
    />
  );
}

export const SlidePanel = Object.assign(SlidePanelRoot, {
  Content,
  Header,
  Body,
  Footer,
  ResizeHandle,
});
