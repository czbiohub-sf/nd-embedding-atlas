import { MOD_KEY } from "@ndea/ui/lib/platform";
import { cn } from "@ndea/ui/lib/utils";

/** Design data/Kbd.jsx: muted keycap with a bottom keyline, mono 10.5px. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex w-fit select-none items-center gap-1 rounded-xs bg-muted px-[5px] py-px font-mono text-text-muted text-xs leading-[1.4] shadow-[inset_0_-1px_0_var(--line-2)] [&_svg:not([class*='size-'])]:size-3",
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
