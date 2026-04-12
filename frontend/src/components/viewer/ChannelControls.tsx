import { EyeIcon, EyeOffIcon, Layers } from "lucide-react";
import { useState } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import { Toggle } from "../ui/toggle";
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

export function ChannelControls() {
  const { state, actions } = useViewer();
  const { channels, viewMode } = state;
  const [minimized, setMinimized] = useState(true);

  if (channels.length === 0) return null;

  // ── Minimized: icon badge ──────────────────────────────────────────────────
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        aria-label="Open channel controls"
        className="flex size-7 items-center justify-center rounded-lg border border-white/[0.07] bg-card/80 text-muted-foreground backdrop-blur-md transition-colors hover:text-foreground"
      >
        <Layers className="size-3.5" />
      </button>
    );
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <div className="flex max-h-[min(50vh,360px)] flex-col overflow-hidden rounded-lg border border-white/[0.07] bg-card/80 backdrop-blur-md">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Layers className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 font-medium text-[10px] text-muted-foreground/70">Channels</span>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize channel controls"
          className="flex size-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        >
          <span className="text-[11px] leading-none">—</span>
        </button>
      </div>

      {/* Scrollable channel list */}
      <ScrollArea className="min-h-0 flex-1">
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

                  <span className="flex-1 truncate text-[10px] text-foreground/80">{ch.label}</span>

                  {viewMode === "2d" && (
                    <Select
                      value={ch.blendMode}
                      onValueChange={(v) => actions.setChannelProp(i, { blendMode: v as BlendMode })}
                    >
                      <SelectTrigger className="h-5 w-16 rounded px-1.5 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BLEND_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-[10px]">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Contrast range (dual-thumb slider + editable inputs) */}
                <div className="flex items-center gap-1.5 pl-7">
                  <input
                    type="number"
                    value={Math.round(ch.contrastLimits[0])}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) {
                        actions.setChannelProp(i, { contrastLimits: [v, ch.contrastLimits[1]] });
                      }
                    }}
                    className="w-10 rounded border border-border bg-transparent px-1 text-right text-[10px] text-muted-foreground tabular-nums outline-none focus:border-primary/50 focus:text-foreground"
                  />
                  <Slider
                    className="flex-1"
                    value={[ch.contrastLimits[0], ch.contrastLimits[1]]}
                    min={ch.contrastRange[0]}
                    max={ch.contrastRange[1]}
                    step={step}
                    onValueChange={(v) => {
                      const vals = Array.isArray(v) ? v : [v, v];
                      actions.setChannelProp(i, { contrastLimits: [vals[0], vals[1]] });
                    }}
                  />
                  <input
                    type="number"
                    value={Math.round(ch.contrastLimits[1])}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) {
                        actions.setChannelProp(i, { contrastLimits: [ch.contrastLimits[0], v] });
                      }
                    }}
                    className="w-10 rounded border border-border bg-transparent px-1 text-[10px] text-muted-foreground tabular-nums outline-none focus:border-primary/50 focus:text-foreground"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
