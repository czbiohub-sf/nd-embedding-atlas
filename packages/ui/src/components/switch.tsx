import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "@ndea/ui/lib/utils";

/** On/off switch (prototype settings switch): 28×16 track, primary when on; 12px knob slides 12px. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full bg-muted-2 outline-none transition-colors duration-160 focus-visible:ring-1 focus-visible:ring-ring data-checked:bg-primary data-disabled:cursor-default data-disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="absolute top-0.5 left-0.5 size-3 rounded-full bg-text-muted shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-[translate,background-color] duration-160 ease-(--ease-out) data-checked:translate-x-3 data-checked:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
