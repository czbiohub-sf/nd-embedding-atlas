/**
 * Presets are workspace documents. A new workspace file starts from a
 * built-in preset by name, or from any `.json` workspace document path.
 */

import { parseWorkspaceDocument, type WorkspaceDocument } from "../frontend/core/workspace/document.ts";
import annotate from "../presets/annotate.json";
import { WorkspaceFileError } from "./workspace.ts";

const BUILT_IN: Record<string, unknown> = { annotate };

export const DEFAULT_PRESET = "annotate";

export async function loadPreset(preset: string): Promise<WorkspaceDocument> {
  const raw = Object.hasOwn(BUILT_IN, preset)
    ? BUILT_IN[preset]
    : preset.endsWith(".json")
      ? await Bun.file(preset).json()
      : undefined;
  if (raw === undefined) {
    throw new Error(
      `unknown preset "${preset}": use ${Object.keys(BUILT_IN).join(", ")} or a .json workspace document`,
    );
  }
  const parsed = parseWorkspaceDocument(raw);
  if (!parsed.ok) throw new WorkspaceFileError(preset, parsed.issues);
  return parsed.value;
}
