import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";
import { toggleVariants } from "@ndea/ui/components/toggle";
import { cn } from "@ndea/ui/lib/utils";

/** `variant="segmented"` is the segmented control: muted track, pressed option on a raised card thumb. */
const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: "default",
  variant: "default",
});

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: ToggleGroupPrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      className={cn(
        "flex w-fit items-center data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        variant === "segmented" && "gap-px rounded-md bg-muted p-0.5",
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "shrink-0 focus-visible:z-10",
        toggleVariants({ variant: context.variant || variant, size: context.size || size }),
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

/** Single-choice segmented control over string values. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: NoInfer<T>; label: string; disabled?: boolean }[];
  onChange(value: NoInfer<T>): void;
}) {
  return (
    <ToggleGroup
      variant="segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next: string[]) => {
        const picked = options.find((option) => option.value === next[0]);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export { Segmented, ToggleGroup, ToggleGroupItem };
