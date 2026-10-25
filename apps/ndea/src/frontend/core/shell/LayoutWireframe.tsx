/** A layout's tile grid in miniature, drawn from its `split` ratios and `stack`s (Layouts flyout; ⌘K previews). */

import { cn } from "@ndea/ui/lib/utils";

import { componentProps, type Dashboard } from "@/core/workspace/dashboard";

function Cell({ spec, id, grow }: { spec: Dashboard; id: string; grow: number }) {
  const element = spec.elements[id];
  const style = { flex: `${grow} 1 0` };
  if (element?.type !== "split" && element?.type !== "stack") {
    return (
      <span
        style={style}
        className={cn(
          "min-h-0 min-w-0 rounded-[2px]",
          element?.type === "slot" ? "border border-dashed border-line-2" : "bg-muted-2",
        )}
      />
    );
  }
  const { direction, ratio } = componentProps(element);
  const grows =
    element.type === "split" && typeof ratio === "number" ? [ratio, 1 - ratio] : element.children.map(() => 1);
  return (
    <span style={style} className={cn("flex min-h-0 min-w-0 gap-0.5", direction === "column" && "flex-col")}>
      {element.children.map((child, index) => (
        <Cell key={child} spec={spec} id={child} grow={grows[index]} />
      ))}
    </span>
  );
}

export function LayoutWireframe({ spec, className }: { spec: Dashboard; className?: string }) {
  return (
    <span aria-hidden className={cn("flex", className)}>
      <Cell spec={spec} id={spec.root} grow={1} />
    </span>
  );
}
