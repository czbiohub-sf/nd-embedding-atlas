/**
 * NdIconButton: THE standard header button for node frames and tiles.
 *
 * Icon from the ND_ICONS registry · optional mono label · tones:
 * default | active (periwinkle) | amber. 15px box (14 compact),
 * grid-centered, stops propagation, data-nodrag. Plugins declare actions as
 * { icon, title, onClick } and the host renders them with this: never
 * hand-style a header button.
 */

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@ndea/ui/lib/utils";
import { NdIcon, type NdIconName } from "./nd-icons";

export const ndIconButtonVariants = cva(
  "box-border inline-flex shrink-0 cursor-pointer items-center justify-center gap-[3px] rounded-[3px] border font-mono leading-none whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
  {
    variants: {
      tone: {
        default:
          "border-border/70 bg-background text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground",
        active: "border-primary bg-primary text-primary-foreground hover:bg-primary/80",
        amber: "border-wire-sel/50 bg-warning-emphasis text-foreground hover:bg-wire-sel/20",
      },
      compact: {
        false: "h-[15px] min-w-[15px] text-[9px]",
        true: "h-[14px] min-w-[14px] text-[8.5px]",
      },
    },
    defaultVariants: { tone: "default", compact: false },
  },
);

export interface NdAction {
  icon: NdIconName;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  tone?: "default" | "amber";
  label?: string;
}

export function NdIconButton({
  icon,
  title,
  onClick,
  active = false,
  tone = "default",
  compact = false,
  label = null,
  className,
  style,
}: {
  icon: NdIconName;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  tone?: "default" | "amber";
  compact?: boolean;
  label?: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <ButtonPrimitive
      type="button"
      data-nodrag="1"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        ndIconButtonVariants({ tone: active ? "active" : tone, compact }),
        label ? "pr-[5px] pl-1" : "px-[3px]",
        className,
      )}
      style={style}
    >
      <NdIcon name={icon} size={compact ? 8 : 9} />
      {label ? <span>{label}</span> : null}
    </ButtonPrimitive>
  );
}
