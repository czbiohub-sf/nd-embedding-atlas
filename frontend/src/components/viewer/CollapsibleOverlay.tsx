import { useState } from "react";

interface CollapsibleOverlayProps {
  title: string;
  position: "top-left" | "bottom-left" | "top-right" | "bottom-right";
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

const POSITION_CLASSES: Record<CollapsibleOverlayProps["position"], string> = {
  "top-left": "top-2 left-2",
  "bottom-left": "bottom-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-right": "bottom-2 right-2",
};

export function CollapsibleOverlay({ title, position, defaultExpanded = true, children }: CollapsibleOverlayProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={`viewer-overlay ${POSITION_CLASSES[position]}`}>
      <button
        type="button"
        className="viewer-overlay-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className="viewer-overlay-chevron">{expanded ? "\u25BE" : "\u25B8"}</span>
        {title}
      </button>
      {expanded ? <div className="viewer-overlay-content">{children}</div> : null}
    </div>
  );
}
