/**
 * HoverTip: tooltip with a label and an optional one-line description.
 *
 * Timing comes from the app's shared TooltipProvider (500ms, instant between
 * neighbours). Drop-in for Tooltip in icon-only controls.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface HoverTipProps {
  /** Short name of the action. */
  label: string;
  /** One phrase describing the action. */
  description?: string;
  /** Trigger element: rendered as the tooltip anchor. */
  render?: React.ReactElement;
  children?: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function HoverTip({ label, description, render, children, side = "bottom" }: HoverTipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side={side} className="flex-col items-start gap-0.5">
        <span className="font-medium">{label}</span>
        {description ? <span className="text-text-muted">{description}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
