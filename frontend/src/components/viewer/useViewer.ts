import { use } from "react";
import { ViewerContext, type ViewerContextValue } from "./ViewerContext";

export function useViewer(): ViewerContextValue {
  const ctx = use(ViewerContext);
  if (ctx == null) {
    const msg = "useViewer must be used within a Viewer.Provider";
    throw new Error(msg);
  }
  return ctx;
}
