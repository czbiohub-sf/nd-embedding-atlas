import type { NdForm } from "@/components/nd/nd-resolve-form";
import type { NdLedState } from "@/components/nd/nd-primitives";
import type { AppNodeDescriptor } from "@/core/node/library";

export type NdGraphNodeBodyMode = "hidden" | "fullscreen-placeholder" | "socket" | "compact-placeholder";

export function isNodeCountActive(definition: AppNodeDescriptor | null, form: NdForm): boolean {
  if (!definition) return false;

  const { nodeTypeId } = definition.definitionRef;
  if (nodeTypeId === "count" || nodeTypeId === "subnet" || nodeTypeId === "proxy") return false;
  return definition.role !== "view" || form === "chip";
}

export function shouldShowNodeCount(
  definition: AppNodeDescriptor | null,
  countActive: boolean,
  staged: boolean,
): boolean {
  if (!definition) return false;
  return countActive || (definition.role === "view" && staged);
}

export function formatNodeCount({
  visible,
  error,
  cooking,
  count,
}: {
  visible: boolean;
  error: string | null;
  cooking: boolean;
  count: number | null;
}): string | null {
  if (!visible) return null;
  if (error) return "✗";
  if (cooking) return "…";
  return count === null ? null : count.toLocaleString("en-US");
}

export function resolveNodeLedState({
  telemetryOn,
  flagged,
  cooking,
  dirty,
}: {
  telemetryOn: boolean;
  flagged: boolean;
  cooking: boolean;
  dirty: boolean;
}): NdLedState | null {
  if (!telemetryOn) return null;
  if (flagged) return "idle";
  if (cooking) return "cooking";
  return dirty ? "dirty" : "clean";
}

export function resolveNodeBodyMode({
  form,
  staged,
  hasBody,
  fullscreen,
  body,
}: {
  form: NdForm;
  staged: boolean;
  hasBody: boolean;
  fullscreen: boolean;
  body: "card-and-full" | "full-only" | undefined;
}): NdGraphNodeBodyMode {
  if (form === "chip" || staged || !hasBody) return "hidden";
  if (fullscreen) return "fullscreen-placeholder";
  if (form === "full" || body === "card-and-full") return "socket";
  return "compact-placeholder";
}

export function shouldShowNodeHeader(hasBody: boolean, form: NdForm, staged: boolean, fullscreen: boolean): boolean {
  if (!hasBody || form !== "full") return false;
  return !staged && !fullscreen;
}

export function resolveDisabledNodeStyle(
  flagged: boolean,
  displayOff: boolean,
): { opacity: number; filter: string | undefined } | undefined {
  if (!flagged) return undefined;
  return { opacity: 0.45, filter: displayOff ? "grayscale(0.8)" : undefined };
}

export function formatCookStatus(cooking: boolean, cookMs?: number): string {
  if (cooking) return "cooking…";
  return cookMs === undefined ? "cook —" : `cook ${cookMs.toFixed(1)}ms`;
}
