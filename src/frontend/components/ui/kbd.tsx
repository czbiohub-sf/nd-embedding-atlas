import { MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-xs bg-muted in-data-[slot=tooltip-content]:bg-background/20 px-1 font-medium font-sans in-data-[slot=tooltip-content]:text-background text-[0.625rem] text-muted-foreground dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <kbd data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}

/**
 * Platform-aware modifier key. Renders ⌘ on macOS, Ctrl elsewhere.
 * Use in keyboard-shortcut hints next to other Kbd elements.
 */
function KbdMod({ className, ...props }: Omit<React.ComponentProps<"kbd">, "children">) {
  return (
    <Kbd className={className} {...props}>
      {MOD_KEY}
    </Kbd>
  );
}

export { Kbd, KbdGroup, KbdMod };
