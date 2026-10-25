import type { ChannelStat } from "@ndea/protocol";
import { Checkbox } from "@ndea/ui/components/checkbox";
import { NdChannelsIcon } from "@ndea/ui/components/nd-icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Slider } from "@ndea/ui/components/slider";
import { ControlHeading, ControlPopover, ControlRow } from "../../scatter/ScatterControls";
import { type AutoContrastMethod, deriveAutoLimits } from "../contrast-window";
import { useViewer } from "./useViewer";
import type { BlendMode, ChannelDef } from "./ViewerContext";

/** Named solid colormaps; each writes the channel's hex `color`. */
const COLORMAPS: readonly { name: string; hex: string }[] = [
  { name: "gray", hex: "FFFFFF" },
  { name: "red", hex: "FF0000" },
  { name: "green", hex: "00FF00" },
  { name: "blue", hex: "0000FF" },
  { name: "cyan", hex: "00FFFF" },
  { name: "magenta", hex: "FF00FF" },
  { name: "yellow", hex: "FFFF00" },
];

const BLEND_OPTIONS: readonly { value: BlendMode; label: string }[] = [
  { value: "additive", label: "Additive" },
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "subtractive", label: "Subtractive" },
];

const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US"));
const swatch = (hex: string) => (
  <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: `#${hex}` }} />
);

/** Log-scaled histogram of the 256 `bins` (spanning dataMin..dataMax), placed on the slider's domain. */
function Histogram({ stat, range, limits }: { stat: ChannelStat; range: [number, number]; limits: [number, number] }) {
  const span = range[1] - range[0] || 1;
  const binW = (stat.dataMax - stat.dataMin) / stat.bins.length;
  const top = Math.log1p(Math.max(1, ...stat.bins));
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-3 h-6 px-1.5">
      <svg className="size-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        {stat.bins.map((count, i) => {
          const lo = stat.dataMin + i * binW;
          const h = Math.log1p(count) / top;
          const inRange = lo + binW / 2 >= limits[0] && lo + binW / 2 <= limits[1];
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed bin order
              key={i}
              x={(lo - range[0]) / span}
              width={binW / span}
              y={1 - h}
              height={h}
              className={inRange ? "fill-foreground/70" : "fill-muted-foreground/40"}
            />
          );
        })}
      </svg>
    </div>
  );
}

function ChannelRow({ ch, index }: { ch: ChannelDef; index: number }) {
  const { state, actions } = useViewer();
  const set = (update: Parameters<typeof actions.setChannelProp>[1]) => actions.setChannelProp(index, update);
  const auto = (method: AutoContrastMethod) => ch.stats && set({ contrastLimits: deriveAutoLimits(ch.stats, method) });
  const configured = ch.configuredColor;
  const maps = COLORMAPS.some((m) => m.hex === configured)
    ? COLORMAPS
    : [...COLORMAPS, { name: `#${configured}`, hex: configured }];
  const current = maps.find((m) => m.hex === ch.color.toUpperCase()) ?? { name: `#${ch.color}`, hex: ch.color };
  // With stats the slider spans the data (widened to the current limits), so the
  // histogram fills the track instead of a sliver of the metadata window.
  const [r0, r1]: [number, number] = ch.stats
    ? [Math.min(ch.stats.dataMin, ch.contrastLimits[0]), Math.max(ch.stats.dataMax, ch.contrastLimits[1])]
    : ch.contrastRange;
  const autoButton = "text-2xs text-text-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45";

  return (
    <div className="flex flex-col gap-1 border-border border-t pt-1.5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 px-1.5">
        <Checkbox
          checked={ch.visible}
          onCheckedChange={(visible) => set({ visible })}
          aria-label={`Show ${ch.label}`}
        />
        <span className="min-w-0 flex-1 truncate text-ui">{ch.label}</span>
        <Select value={current.hex} onValueChange={(hex) => hex && set({ color: hex })}>
          <SelectTrigger size="sm" aria-label={`${ch.label} colormap`} className="w-24">
            <SelectValue>
              {() => (
                <span className="flex items-center gap-1.5">
                  {swatch(current.hex)}
                  {current.name}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {maps.map((m) => (
              <SelectItem key={m.hex} value={m.hex}>
                {swatch(m.hex)}
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="relative px-1.5 pt-6">
        {ch.stats && <Histogram stat={ch.stats} range={[r0, r1]} limits={ch.contrastLimits} />}
        <Slider
          aria-label={`${ch.label} contrast limits`}
          value={ch.contrastLimits}
          min={r0}
          max={r1}
          step={(r1 - r0) / 1000 || 1}
          onValueChange={(v) => Array.isArray(v) && set({ contrastLimits: [v[0], v[1]] })}
        />
      </div>
      <div className="flex items-center gap-2 px-1.5 font-mono text-2xs text-text-muted">
        <span>{fmt(ch.contrastLimits[0])}</span>
        <span className="flex-1" />
        <button type="button" className={autoButton} disabled={!ch.stats} onClick={() => auto("percentile")}>
          auto
        </button>
        <button type="button" className={autoButton} disabled={!ch.stats} onClick={() => auto("minmax")}>
          min–max
        </button>
        <span className="flex-1" />
        <span>{fmt(ch.contrastLimits[1])}</span>
      </div>
      {state.viewMode === "2d" && (
        <ControlRow label="Blend">
          <Select value={ch.blendMode} onValueChange={(blendMode) => blendMode && set({ blendMode })}>
            <SelectTrigger size="sm" aria-label={`${ch.label} blend mode`} className="w-24">
              <SelectValue>{(v: BlendMode) => BLEND_OPTIONS.find((o) => o.value === v)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BLEND_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ControlRow>
      )}
    </div>
  );
}

/** Channels button + panel: visibility, colormap, contrast over the histogram, blend. */
export function ChannelControls({ side }: { side: "right" | "bottom" }) {
  const { state } = useViewer();
  if (state.channels.length === 0) return null;
  return (
    <ControlPopover
      icon={<NdChannelsIcon />}
      label="Channels"
      description="Visibility, colormap and contrast"
      title="Channels"
      side={side}
      className="max-h-[70vh] w-72 overflow-y-auto"
    >
      {state.channels.length > 1 && <ControlHeading>{state.channels.length} channels</ControlHeading>}
      <div className="flex flex-col gap-1.5">
        {state.channels.map((ch, i) => (
          <ChannelRow key={ch.label} ch={ch} index={i} />
        ))}
      </div>
    </ControlPopover>
  );
}
