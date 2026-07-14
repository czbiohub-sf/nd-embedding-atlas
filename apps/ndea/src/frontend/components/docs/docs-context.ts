import { createContext, useContext } from "react";
import type { ExactNodeTypeRef } from "@ndea/sdk";

/**
 * Imperative controls for the in-app docs surfaces — the ⌘K search palette and
 * the full-docs sheet. Provided by `<DocsProvider>`; consumed by the node info
 * button ("see full docs") and anything else that wants to open docs.
 */
export interface DocsContextValue {
  /** Open the ⌘K docs search palette. */
  openCommand: () => void;
  /** Open the full-docs sheet for a node type. */
  openDocs: (definitionRef: ExactNodeTypeRef) => void;
}

export const DocsContext = createContext<DocsContextValue | null>(null);

/** Null when rendered outside `<DocsProvider>` (e.g. the standalone spec page). */
export function useDocs(): DocsContextValue | null {
  return useContext(DocsContext);
}
