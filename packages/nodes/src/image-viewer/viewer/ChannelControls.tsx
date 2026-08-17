import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  EyeIcon,
  EyeOffIcon,
  Layers,
  WandSparklesIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@ndea/ui/components/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ndea/ui/components/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@ndea/ui/components/dropdown-menu";
import { Input } from "@ndea/ui/components/input";
import { Panel } from "@ndea/ui/components/panel";
import { ScrollArea } from "@ndea/ui/components/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Slider } from "@ndea/ui/components/slider";
import { Toggle } from "@ndea/ui/components/toggle";
import { type AutoContrastMethod, deriveAutoLimits } from "../contrast-window";
import { useViewer } from "./useViewer";
import type { BlendMode } from "./ViewerContext";

const BLEND_OPTIONS: { label: string; value: BlendMode }[] = [
  { label: "Additive", value: "additive" },
  { label: "Normal", value: "normal" },
  { label: "Multiply", value: "multiply" },
  { label: "Subtractive", value: "subtractive" },
];

const blendLabel = (v: BlendMode): string => BLEND_OPTIONS.find((o) => o.value === v)?.label ?? v;

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
      // text (not number): the native number spinners ate the right edge of the
      // right-aligned value, clipping the last digit (e.g. "-0.20" → "-0.2"). We
      // parse + clamp on commit anyway, so the spinners add nothing.
      type="text"
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
      className="h-5 w-16 px-1.5 text-right text-3xs tabular-nums"
    />
  );
}

export function ChannelControls() {
  const { state, actions } = useViewer();
  const { channels, viewMode } = state;
  const [minimized, setMinimized] = useState(true);

  // Autocontrast: method travels WITH the action (no global mode). Applying is a
  // one-shot derivation from the channel's pixel stats → display limits.
  const applyAuto = (index: number, method: AutoContrastMethod) => {
    const stat = channels[index]?.stats;
    if (stat) actions.setChannelProp(index, { contrastLimits: deriveAutoLimits(stat, method) });
  };
  const anyStats = channels.some((c) => c.stats);
  const autoAll = () => {
    channels.forEach((c, i) => {
      if (c.stats) actions.setChannelProp(i, { contrastLimits: deriveAutoLimits(c.stats, "percentile") });
    });
  };
  // Per-channel disclosure. Tracks the EXPANDED set so new/unknown channels
  // default collapsed (the panel opens compact; expand a channel to tune it).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const setOpen = (label: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(label);
      else next.delete(label);
      return next;
    });

  if (channels.length === 0) return null;

  const allExpanded = channels.every((c) => expanded.has(c.label));

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
  // Fixed width so the dual-thumb contrast slider gets real track (it was ~56px
  // squeezed between the two numeric bounds); capped to the tile so a narrow
  // staged viewer can't overflow.
  return (
    <Panel variant="glass" depth={2} className="flex w-[340px] max-w-[calc(100%-1rem)] flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
        <Layers className="size-3 shrink-0 text-muted-foreground/60" />
        <span className="flex-1 font-medium text-3xs text-muted-foreground/70">Channels</span>
        <Button
          variant="outline"
          size="xs"
          onClick={autoAll}
          disabled={!anyStats}
          title="Auto-contrast every channel (percentile). Use a channel's ▾ for min–max."
          aria-label="Auto-contrast all channels"
        >
          <WandSparklesIcon />
          Auto all
        </Button>
        <button
          type="button"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(channels.map((c) => c.label)))}
          aria-label={allExpanded ? "Collapse all channels" : "Expand all channels"}
          title={allExpanded ? "collapse all" : "expand all"}
          className="flex size-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        >
          {allExpanded ? <ChevronsDownUpIcon className="size-3" /> : <ChevronsUpDownIcon className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize channel controls"
          className="flex size-4 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        >
          <span className="text-2xs leading-none">:</span>
        </button>
      </div>

      {/* Scrollable channel list */}
      <ScrollArea className="max-h-72">
        <div className="flex flex-col px-2 pb-2">
          {channels.map((ch, i) => {
            const step = (ch.contrastRange[1] - ch.contrastRange[0]) / 200 || 1;
            const open = expanded.has(ch.label);

            return (
              // List row + hairline divider (NOT a nested card). The body
              // discloses under the always-visible identity row.
              <Collapsible
                key={ch.label}
                open={open}
                onOpenChange={(o) => setOpen(ch.label, o)}
                className="border-border/30 border-t py-1.5 first:border-t-0 first:pt-0"
              >
                {/* Always visible: visibility · color · (chevron + name = trigger) */}
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

                  <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left">
                    <ChevronRightIcon
                      className={`size-3 shrink-0 text-muted-foreground/70 transition-[rotate] duration-150 ease-out ${open ? "rotate-90" : ""}`}
                    />
                    <span className="flex-1 truncate text-3xs text-foreground/80">{ch.label}</span>
                  </CollapsibleTrigger>
                </div>

                {/* Disclosed: blend (full label) + contrast range */}
                <CollapsibleContent>
                  <div className="flex flex-col gap-1 pt-1.5 pl-7">
                    {viewMode === "2d" && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0 text-3xs text-muted-foreground">blend</span>
                        <Select
                          value={ch.blendMode}
                          onValueChange={(v) => actions.setChannelProp(i, { blendMode: v as BlendMode })}
                        >
                          <SelectTrigger className="h-5 w-fit gap-1 rounded px-1.5 text-3xs">
                            <SelectValue>{(value) => blendLabel(value as BlendMode)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {BLEND_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value} className="text-3xs">
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5">
                      {/* Split button: ✨ = auto (percentile, the default); ▾ = pick method.
                          Method travels with the click, so there's no mode to remember. */}
                      <div className="flex shrink-0 items-center">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="rounded-r-none"
                          disabled={!ch.stats}
                          onClick={() => applyAuto(i, "percentile")}
                          aria-label={`Auto-contrast ${ch.label}`}
                          title={ch.stats ? "Auto-contrast (percentile)" : "Auto-contrast unavailable"}
                        >
                          <WandSparklesIcon />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={!ch.stats}
                            aria-label={`Auto-contrast method for ${ch.label}`}
                            className="inline-flex h-5 w-3 items-center justify-center rounded-sm rounded-l-none border border-transparent border-l-border/30 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-muted aria-expanded:text-foreground [&_svg]:size-2.5"
                          >
                            <ChevronDownIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-40">
                            <DropdownMenuItem onClick={() => applyAuto(i, "percentile")}>
                              <WandSparklesIcon />
                              <span>Percentile</span>
                              <DropdownMenuShortcut>robust</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => applyAuto(i, "minmax")}>
                              <span>Min–Max</span>
                              <DropdownMenuShortcut>full range</DropdownMenuShortcut>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </Panel>
  );
}
