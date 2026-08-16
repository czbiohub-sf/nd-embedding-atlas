/**
 * HoverTip: a delayed, two-line tooltip.
 *
 * Appears after `delay` ms with a bold label and a short description.
 * Drop-in for Tooltip in icon-only controls.
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

interface HoverTipProps {
  /** Short name shown in bold. */
  label: string;
  /** One phrase describing the action. */
  description: string;
  /** Trigger element: rendered as the tooltip anchor. */
  render?: React.ReactElement;
  children?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Hover delay in ms. Defaults to 700. */
  delay?: number;
}

export function HoverTip({ label, description, render, children, side = "bottom", delay = 700 }: HoverTipProps) {
  return (
    <TooltipProvider delay={delay}>
      <Tooltip>
        <TooltipTrigger render={render}>{children}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={6} variant="glass">
          <span className="font-semibold text-foreground text-xs leading-none">{label}</span>
          <span className="mt-1 text-3xs text-muted-foreground leading-snug">{description}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
