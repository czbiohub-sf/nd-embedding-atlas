import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";

/** Panel: solid floating chrome over canvases and images (overlay fill, popover keyline + shadow, 8.4px radius). */
function Panel({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      data-slot="panel"
      className={cn("overflow-hidden rounded-lg bg-overlay text-foreground shadow-(--shadow-popover)", className)}
      {...props}
    />
  );
}

export { Panel };
