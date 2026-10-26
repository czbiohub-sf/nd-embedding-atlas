/** A layout's tile grid in miniature, drawn from its `split` ratios and `stack`s (Layouts flyout; ⌘K rows and preview). */

import { cn } from "@ndea/ui/lib/utils";

import { componentProps, tileTitle, type Dashboard } from "@/core/workspace/dashboard";

function Cell({ spec, id, grow, labeled }: { spec: Dashboard; id: string; grow: number; labeled: boolean }) {
  const element = spec.elements[id];
  const style = { flex: `${grow} 1 0` };
  if (element?.type !== "split" && element?.type !== "stack") {
    return (
      <span
        style={style}
        className={cn(
          "flex min-h-0 min-w-0 items-end overflow-hidden rounded-[2px]",
          element?.type === "slot" ? "border border-dashed border-line-2" : "bg-accent",
        )}
      >
        {labeled && element && (
          <span className="truncate px-1 pb-0.5 text-2xs text-text-muted">{tileTitle(spec, id)}</span>
        )}
      </span>
    );
  }
  const { direction, ratio } = componentProps(element);
  const grows =
    element.type === "split" && typeof ratio === "number" ? [ratio, 1 - ratio] : element.children.map(() => 1);
  return (
    <span style={style} className={cn("flex min-h-0 min-w-0 gap-0.5", direction === "column" && "flex-col")}>
      {element.children.map((child, index) => (
        <Cell key={child} spec={spec} id={child} grow={grows[index]} labeled={labeled} />
      ))}
    </span>
  );
}

/** `labeled` writes each tile's title into its cell (the ⌘K preview). */
export function LayoutWireframe({
  spec,
  className,
  labeled = false,
}: {
  spec: Dashboard;
  className?: string;
  labeled?: boolean;
}) {
  return (
    <span aria-hidden className={cn("flex", className)}>
      <Cell spec={spec} id={spec.root} grow={1} labeled={labeled} />
    </span>
  );
}
