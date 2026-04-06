/**
 * PiPButton — reusable Picture-in-Picture toggle button.
 * Renders as a small glass icon button suitable for panel overlays.
 */

import { PictureInPicture2Icon, PictureInPictureIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props {
  isPiP: boolean;
  isSupported: boolean;
  onOpen: () => void;
  onClose: () => void;
  className?: string;
}

export function PiPButton({ isPiP, isSupported, onOpen, onClose, className }: Props) {
  if (!isSupported) return null;

  return (
    <Tooltip>
      <TooltipTrigger>
        <button
          type="button"
          onClick={isPiP ? onClose : onOpen}
          className={cn(
            "flex size-[22px] items-center justify-center rounded-md transition-colors hover:bg-white/10",
            isPiP ? "text-primary" : "text-muted-foreground hover:text-foreground",
            className,
          )}
          aria-label={isPiP ? "Exit picture-in-picture" : "Open in picture-in-picture"}
        >
          {isPiP ? <PictureInPicture2Icon className="size-3.5" /> : <PictureInPictureIcon className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{isPiP ? "Exit PiP" : "Picture in picture"}</TooltipContent>
    </Tooltip>
  );
}
