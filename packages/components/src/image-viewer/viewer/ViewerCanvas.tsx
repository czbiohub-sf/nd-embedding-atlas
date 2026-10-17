import { use } from "react";
import { ViewerContext } from "./ViewerContext";

interface Props {
  className?: string;
}

export function ViewerCanvas({ className }: Props) {
  const ctx = use(ViewerContext);
  if (!ctx) {
    const msg = "ViewerCanvas must be used within a Viewer.Provider";
    throw new Error(msg);
  }

  const { _attachCanvas } = ctx;
  return <canvas ref={_attachCanvas} className={className} />;
}
