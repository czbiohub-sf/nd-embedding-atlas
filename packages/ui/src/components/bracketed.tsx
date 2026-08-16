import { cn } from "@ndea/ui/lib/utils";

/**
 * Bracketed: wraps content in the brand's brackets: [content].
 *
 * Brand rule: brackets mark rigorous technical substance (IDs, counts, dates,
 * tool names): not ordinary words. Same weight as the text, no inner space;
 * the brackets sit at reduced opacity so the value stays dominant.
 *
 *   <Bracketed>70,121</Bracketed>   → [70,121]
 *
 * Pairs with font-hud (Geist Pixel) for HUD readouts.
 */
export function Bracketed({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="opacity-50">[</span>
      {children}
      <span className="opacity-50">]</span>
    </span>
  );
}
