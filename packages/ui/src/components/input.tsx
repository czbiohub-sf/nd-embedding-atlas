import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";

/** Design forms/Input.jsx: muted fill, no border, 11.5px type. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[26px] w-full min-w-0 rounded-sm bg-muted px-2 py-1 text-foreground text-ui-sm outline-none file:inline-flex file:h-5 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-ui-sm placeholder:text-text-muted focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:ring-1 aria-invalid:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
