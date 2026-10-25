import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";

import { cn } from "@ndea/ui/lib/utils";

/** Design forms/Checkbox.jsx: 13px box, line-3 keyline when off, primary fill when on or mixed. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "inline-flex size-[13px] shrink-0 items-center justify-center rounded-xs text-primary-foreground shadow-[inset_0_0_0_1.5px_var(--line-3)] outline-none focus-visible:ring-1 focus-visible:ring-ring data-checked:bg-primary data-indeterminate:bg-primary data-checked:shadow-none data-indeterminate:shadow-none data-disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex">
        <CheckIcon className="size-2.5 in-data-indeterminate:hidden" strokeWidth={3} />
        <MinusIcon className="hidden size-2.5 in-data-indeterminate:block" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
