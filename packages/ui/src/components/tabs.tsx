"use client";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@ndea/ui/lib/utils";

/** Tabs (design navigation/Tabs.jsx): muted track, active tab on a raised card thumb. */
const Tabs = TabsPrimitive.Root;

function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("relative inline-flex min-w-0 items-center gap-px rounded-md bg-muted p-0.5", className)}
      {...props}
    >
      <TabsPrimitive.Indicator className="absolute top-(--active-tab-top) left-(--active-tab-left) h-(--active-tab-height) w-(--active-tab-width) rounded-sm bg-card shadow-(--shadow-raised)" />
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-1 flex cursor-pointer select-none items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-text-muted text-ui outline-none",
        "focus-visible:ring-1 focus-visible:ring-ring data-active:font-medium data-active:text-foreground data-disabled:opacity-45",
        "[&_svg:not([class*='size-'])]:size-3 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel data-slot="tabs-content" className={cn("min-h-0 flex-1 outline-none", className)} {...props} />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
