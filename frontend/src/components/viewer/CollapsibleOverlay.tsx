import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../../lib/utils";

type Position = "top-left" | "bottom-left" | "top-right" | "bottom-right";

const POSITION_CLASSES: Record<Position, string> = {
  "top-left": "top-2 left-2",
  "bottom-left": "bottom-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-right": "bottom-2 right-2",
};

interface Props {
  title: string;
  position: Position;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CollapsibleOverlay({ title, position, defaultExpanded = true, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("absolute z-20 flex flex-col gap-1", POSITION_CLASSES[position])}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex items-center gap-1 self-start rounded-md border border-white/[0.07] bg-card/80 px-2 py-0.5 text-[10px] text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
        {title}
      </button>
      {expanded && children}
    </div>
  );
}
