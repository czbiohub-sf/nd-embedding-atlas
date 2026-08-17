import type { ReactNode } from "react";
import { cn } from "@ndea/ui/lib/utils";

interface ButtonGroupProps {
  children: ReactNode;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

/**
 * ButtonGroup: segments related buttons into a single visual control.
 *
 * Direct children lose their individual border-radius and duplicate borders
 * are collapsed, giving a segmented-control appearance. Works with <button>,
 * <Button>, ToggleGroupItem, and any element that renders a button root.
 */
export function ButtonGroup({ children, className, orientation = "horizontal" }: ButtonGroupProps) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-md border border-input",
        orientation === "vertical" && "flex-col",
        "[&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none",
        orientation === "horizontal"
          ? "[&>*+*]:border-input [&>*+*]:border-l"
          : "[&>*+*]:border-input [&>*+*]:border-t",
        className,
      )}
    >
      {children}
    </div>
  );
}
