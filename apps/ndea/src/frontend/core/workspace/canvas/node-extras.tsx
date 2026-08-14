/** Generic Canvas flags, feedback badges, and coordination affordances. */

import { IterationCw, Link2 } from "lucide-react";

import { NdIconButton } from "@/components/nd/nd-icon-button";
import { NdHud } from "@/components/nd/nd-primitives";
import type { GraphDocumentNode } from "@/core/graph/records";
import { ON_ACCENT_INK } from "@/lib/color/brand";
import type { FeedbackChannel } from "../feedback";
import { useWorkspace, useWorkspaceSelector } from "../workspace-context";
import { ScopePicker } from "./scope-picker";

const FEEDBACK_COLOR = "var(--color-wire-feedback)";

const feedbackNames = (channels: FeedbackChannel[], pick: (channel: FeedbackChannel) => string) =>
  [...new Set(channels.map(pick))].join(", ");

export function FeedbackBadges({ nodeId, channels }: { nodeId: string; channels: readonly FeedbackChannel[] }) {
  const emits = channels.filter((channel) => channel.from === nodeId);
  const receives = channels.filter((channel) => channel.to === nodeId);
  if (emits.length === 0 && receives.length === 0) return null;

  return (
    <>
      {emits.length > 0 ? (
        <span
          data-nodrag="1"
          title={`feedback → re-enters ${feedbackNames(emits, (channel) => channel.toLabel)} (writes a column back into the source data)`}
          className="absolute z-[8] inline-flex items-center rounded-full px-[3px] py-[2px]"
          style={{ right: -7, bottom: -9, background: FEEDBACK_COLOR, color: ON_ACCENT_INK }}
        >
          <IterationCw size={11} strokeWidth={2.4} />
        </span>
      ) : null}
      {receives.length > 0 ? (
        <span
          data-nodrag="1"
          title={`feedback ← ${feedbackNames(receives, (channel) => channel.fromLabel)} writes a column that re-enters this source`}
          className="absolute z-[8] inline-flex items-center rounded-full border bg-card px-[3px] py-[2px]"
          style={{ left: -7, bottom: -9, borderColor: FEEDBACK_COLOR, color: FEEDBACK_COLOR }}
        >
          <IterationCw size={11} strokeWidth={2.4} />
        </span>
      ) : null}
    </>
  );
}

export function FlagButton({ node, compact = false }: { node: GraphDocumentNode; compact?: boolean }) {
  const workspace = useWorkspace();
  const flags = useWorkspaceSelector((state) => state.flags[node.id] ?? {});
  const definition = workspace.def(node.id);
  if (!definition) return null;

  if (definition.role === "transform" || definition.role === "subnet") {
    return (
      <NdIconButton
        icon="bypass"
        tone={flags.bypass ? "amber" : "default"}
        compact={compact}
        title={
          flags.bypass
            ? "bypassed: input passes through uncooked · click to restore (b)"
            : "bypass: pass input through uncooked (b)"
        }
        onClick={() => workspace.toggleFlag(node.id, "bypass")}
      />
    );
  }

  if (definition.role === "view" && definition.canFull) {
    return (
      <NdIconButton
        icon="power"
        tone={flags.off ? "amber" : "default"}
        compact={compact}
        title={flags.off ? "display off: branch never cooks · click to wake (d)" : "display off: park this view (d)"}
        onClick={() => workspace.toggleFlag(node.id, "off")}
      />
    );
  }

  return null;
}

export function BypassOverlay({ chip }: { chip: boolean }) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[7]"
        style={{
          borderRadius: chip ? 999 : 7,
          background:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--color-wire-sel) 14%, transparent) 0 7px, transparent 7px 15px)",
        }}
      />
      <div
        className="pointer-events-none absolute z-[7] h-0.5 rounded-sm"
        style={{
          left: -6,
          right: -6,
          top: 12,
          background: "var(--color-wire-pred)",
          boxShadow: "0 0 7px oklch(from var(--color-wire-pred) l c h / 90%)",
        }}
      />
    </>
  );
}

export function DisplayOffBadge() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[26px] bottom-0 z-[7] grid place-items-center">
      <NdHud size={8.5} className="rounded border border-dashed border-border-active bg-card px-2 py-[3px]">
        display off · not cooking
      </NdHud>
    </div>
  );
}

export function SyncBadge({ nodeId }: { nodeId: string }) {
  const workspace = useWorkspace();
  const scopes = useWorkspaceSelector((state) => state.coordinationScopes[nodeId] ?? null);
  const entries = scopes ? Object.entries(scopes) : [];
  if (entries.length === 0) return null;

  return (
    <span
      data-nodrag="1"
      className="absolute z-[8] inline-flex items-center gap-[3px]"
      style={{ bottom: -9, left: "50%", transform: "translateX(-50%)" }}
    >
      {entries.map(([type, scope]) => (
        <span
          key={type}
          title={`${type} scope ${scope}: peers share ${type}`}
          className="inline-flex items-center gap-[2px] rounded-full px-[5px] py-[2px] text-[8px] font-bold"
          style={{ background: workspace.coordination.scopeColor(scope), color: ON_ACCENT_INK }}
        >
          <Link2 size={9} strokeWidth={2.6} />
          {scope}
        </span>
      ))}
    </span>
  );
}

export function SyncGroupButton({ nodeId }: { nodeId: string }) {
  return <ScopePicker nodeId={nodeId} />;
}
