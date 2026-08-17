import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "@ndea/ui/lib/utils";

function ScrollArea({
  className,
  viewportClassName,
  contentClassName,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  /** Applied to the scroll Viewport: put a `max-h-*`/`h-*` bound HERE (the
   *  actual scroll element), not on the Root: the Viewport is height:100%, so a
   *  bound on a max-height-only Root never bites. */
  viewportClassName?: string;
  /** Applied to the content wrapper. Base UI defaults it to `max-content`
   *  width (for horizontal scroll); pass `min-w-0` for a vertical-only list so
   *  content can't exceed the viewport and force a horizontal scrollbar. */
  contentClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn("relative", className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] outline-none transition-[color,box-shadow] focus-visible:outline-1 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          viewportClassName,
        )}
      >
        {/* Base UI's content wrapper (Root > Viewport > Content > children): lets the
         *  Viewport measure overflow and size the scrollbar thumb correctly. */}
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content" className={contentClassName}>
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation = "vertical", ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none select-none p-px transition-colors data-horizontal:h-2.5 data-vertical:h-full data-vertical:w-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:border-l data-vertical:border-l-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
