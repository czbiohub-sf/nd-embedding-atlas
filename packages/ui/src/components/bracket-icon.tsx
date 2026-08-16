import { Brackets, type LucideIcon } from "lucide-react";
import { cn } from "@ndea/ui/lib/utils";

/**
 * BracketIcon: composes a lucide icon inside the brand's brackets: [icon].
 *
 * The brackets ARE the Biohub identity (the logo's `[o]`), so this is the
 * canonical way to mark a technical thing (an embedding, a data source, a tool).
 * The brackets are stretched horizontally so the inner glyph reads larger.
 *
 *   <BracketIcon icon={ChartScatter} />   → [⋰]   (embedding)
 *   <BracketIcon icon={Database} />        → [▦]   (data / table)
 *
 * Monochrome via currentColor: color it with text-* (e.g. text-primary).
 */
export function BracketIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-6 shrink-0 items-center justify-center", className)}>
      <Brackets className="absolute inset-0 size-full scale-x-[1.35]" strokeWidth={1.5} aria-hidden />
      <Icon className="size-[62%]" strokeWidth={2} aria-hidden />
    </span>
  );
}
