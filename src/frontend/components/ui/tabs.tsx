"use client";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex items-center gap-0 border-border/50 border-b bg-transparent", className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative px-3 py-1.5 font-medium text-[11px] text-muted-foreground/60 transition-colors",
        "cursor-pointer select-none outline-none",
        "hover:text-muted-foreground",
        "data-selected:text-foreground",
        "after:absolute after:right-0 after:bottom-0 after:left-0 after:h-px after:bg-foreground/0",
        "data-selected:after:bg-foreground/60",
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
