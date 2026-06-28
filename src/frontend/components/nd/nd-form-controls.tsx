/**
 * NdFormControls — form cycle + lock buttons (every node header carries them).
 * Cycle sets a per-node form override; lock pins it against zoom changes.
 */

import { NdIconButton } from "./nd-icon-button";
import type { NdForm } from "./nd-resolve-form";

export function NdFormControls({
  form,
  locked,
  onCycle,
  onToggleLock,
  compact = false,
}: {
  form: NdForm;
  locked: boolean;
  onCycle?: (() => void) | null;
  onToggleLock?: (() => void) | null;
  compact?: boolean;
}) {
  if (!onCycle && !onToggleLock) return null;
  return (
    <span className="inline-flex gap-[3px]" data-nodrag="1">
      {onCycle ? (
        <NdIconButton
          icon={`form-${form}`}
          title={`form: ${form} · click to cycle`}
          onClick={onCycle}
          compact={compact}
        />
      ) : null}
      {onToggleLock ? (
        <NdIconButton
          icon={locked ? "lock" : "lock-open"}
          active={locked}
          compact={compact}
          title={locked ? "form locked — click to follow zoom again" : "lock form against zoom"}
          onClick={onToggleLock}
        />
      ) : null}
    </span>
  );
}
