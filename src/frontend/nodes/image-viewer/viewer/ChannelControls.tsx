import { EyeIcon, EyeOffIcon, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { useViewer } from "./useViewer";
import type { BlendMode } from "./ViewerContext";

const BLEND_OPTIONS: { label: string; value: BlendMode }[] = [
  { label: "Add", value: "additive" },
  { label: "Norm", value: "normal" },
  { label: "Mul", value: "multiply" },
  { label: "Sub", value: "subtractive" },
];

function fmtContrast(v: number): string {
  return Math.abs(v) < 10 ? v.toFixed(2) : Math.round(v).toString();
}

/**
 * Editable contrast bound. Tracks a local string while focused so the user can
 * type freely (incl. partial values like "-" or "1."), commits on blur/Enter
 * by parsing + clamping. Reverts on Escape. The displayed value resyncs from
 * `value` whenever the source-of-truth changes (e.g. slider drag).
 */
function ContrastInput({
  value,
  min,
  max,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(() => fmtContrast(value));
  useEffect(() => {
    setDraft(fmtContrast(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(fmtContrast(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onCommit(clamped);
    setDraft(fmtContrast(clamped));
  };

  return (
    <Input
      type="number"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(fmtContrast(value));
          e.currentTarget.blur();
        }
      }}
      className="h-5 w-14 px-1 text-right text-3xs tabular-nums"
    />
  );
}

export function ChannelControls() {
  const { state, actions } = useViewer();
  const { channels, viewMode } = state;
  const [minimized, setMinimized] = useState(true);

  if (channels.length === 0) return null;

  // ── Minimized: icon badge ──────────────────────────────────────────────────
  if (minimized) {
    return (
      <Panel variant="glass" className="size-7">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Open channel controls"
          className="flex size-full items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <Layers className="size-3.5" />
        </button>
      </Panel>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <Panel variant="glass" className="flex flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Layers className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 font-medium text-3xs text-muted-foreground/70">Channels</span>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize channel controls"
          className="flex size-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        >
          <span className="text-2xs leading-none">—</span>
        </button>
      </div>

      {/* Scrollable channel list */}
      <ScrollArea className="max-h-72">
        <div className="flex flex-col gap-2 px-2 pb-2">
          {channels.map((ch, i) => {
            const step = (ch.contrastRange[1] - ch.contrastRange[0]) / 200 || 1;

            return (
              <div key={ch.label} className="flex flex-col gap-1">
                {/* Row: visibility · color · label · blend */}
                <div className="flex items-center gap-1.5">
                  <Toggle
                    size="sm"
                    pressed={ch.visible}
                    onPressedChange={(v) => actions.setChannelProp(i, { visible: v })}
                    aria-label={`Toggle ${ch.label} visibility`}
                    className="size-5 shrink-0 p-0"
                  >
                    {ch.visible ? <EyeIcon /> : <EyeOffIcon />}
                  </Toggle>

                  <input
                    type="color"
                    value={`#${ch.color}`}
                    onChange={(e) =>
                      actions.setChannelProp(i, {
                        color: e.target.value.replace("#", "").toUpperCase(),
                      })
                    }
                    className="size-4 shrink-0 cursor-pointer rounded-sm border-0 bg-transparent p-0"
                    aria-label={`${ch.label} color`}
                  />

                  <span className="flex-1 truncate text-3xs text-foreground/80">{ch.label}</span>

                  {viewMode === "2d" && (
                    <Select
                      value={ch.blendMode}
                      onValueChange={(v) =>
                        actions.setChannelProp(i, {
                          blendMode: v as BlendMode,
                        })
                      }
                    >
                      <SelectTrigger className="h-5 w-16 rounded px-1.5 text-3xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BLEND_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-3xs">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Contrast range (dual-thumb slider + typed numeric bounds) */}
                <div className="flex items-center gap-1.5 pl-7">
                  <ContrastInput
                    value={ch.contrastLimits[0]}
                    min={ch.contrastRange[0]}
                    max={ch.contrastLimits[1]}
                    ariaLabel={`${ch.label} contrast minimum`}
                    onCommit={(lo) =>
                      actions.setChannelProp(i, {
                        contrastLimits: [lo, ch.contrastLimits[1]],
                      })
                    }
                  />
                  <Slider
                    className="flex-1"
                    value={[ch.contrastLimits[0], ch.contrastLimits[1]]}
                    min={ch.contrastRange[0]}
                    max={ch.contrastRange[1]}
                    step={step}
                    onValueChange={(v) => {
                      const vals = Array.isArray(v) ? v : [v, v];
                      actions.setChannelProp(i, {
                        contrastLimits: [vals[0], vals[1]],
                      });
                    }}
                  />
                  <ContrastInput
                    value={ch.contrastLimits[1]}
                    min={ch.contrastLimits[0]}
                    max={ch.contrastRange[1]}
                    ariaLabel={`${ch.label} contrast maximum`}
                    onCommit={(hi) =>
                      actions.setChannelProp(i, {
                        contrastLimits: [ch.contrastLimits[0], hi],
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Panel>
  );
}
