/**
 * Workspace types. The document is the persisted dashboard authority the
 * server owns; the session is this tab's editor state and never leaves the
 * browser.
 */

import type { z } from "zod";
import type { workspaceDocumentSchema } from "./document";

/** Exactly the persisted workspace document: `data`, `spec`, and `state`. */
export type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>;

/** This tab's editor state. Never persisted, never synced. */
export interface WorkspaceSession {
  /** the selected dashboard element */
  selectedElementId: string | null;
  /** element whose body fills the workspace; esc exits */
  fullscreen: string | null;
}
