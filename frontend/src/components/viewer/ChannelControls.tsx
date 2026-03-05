import { useViewer } from "../../hooks/useViewer";
import type { BlendMode } from "./ViewerContext";

const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
    { value: "additive", label: "Add" },
    { value: "normal", label: "Norm" },
    { value: "multiply", label: "Mul" },
    { value: "subtractive", label: "Sub" },
];

export function ChannelControls() {
    const { state, actions } = useViewer();
    const { channels, viewMode } = state;

    if (channels.length === 0) return null;

    return (
        <div className="flex flex-col gap-0.5">
            {channels.map((ch, i) => (
                <div key={ch.label} className="flex items-center gap-1.5">
                    {/* Visibility toggle */}
                    <button
                        type="button"
                        onClick={() => actions.setChannelProp(i, { visible: !ch.visible })}
                        className="flex w-4 shrink-0 items-center justify-center text-[10px] text-text leading-none hover:text-accent-cyan"
                        aria-label={`Toggle ${ch.label}`}
                        title={ch.visible ? "Hide channel" : "Show channel"}
                    >
                        {ch.visible ? "\u25C9" : "\u25CE"}
                    </button>
                    {/* Color swatch */}
                    <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: `#${ch.color}` }}
                    />
                    {/* Label */}
                    <span
                        className="w-12 shrink-0 truncate font-mono text-[10px] text-text"
                        title={ch.label}
                        style={{ opacity: ch.visible ? 1 : 0.4 }}
                    >
                        {ch.label}
                    </span>
                    {/* Blend mode — only in 2D (3D ray marcher handles blending) */}
                    {viewMode === "2d" && (
                        <select
                            value={ch.blendMode}
                            onChange={(e) => actions.setChannelProp(i, { blendMode: e.target.value as BlendMode })}
                            className="h-4 w-11 shrink-0 py-0 pr-3 text-[9px]"
                            aria-label={`${ch.label} blend mode`}
                        >
                            {BLEND_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    )}
                    {/* Contrast min slider */}
                    <input
                        type="range"
                        min={ch.contrastRange[0]}
                        max={ch.contrastRange[1]}
                        value={ch.contrastLimits[0]}
                        onChange={(e) => {
                            const lo = Number(e.target.value);
                            const hi = Math.max(lo + 1, ch.contrastLimits[1]);
                            actions.setChannelProp(i, { contrastLimits: [lo, hi] });
                        }}
                        className="h-1 w-12 shrink-0 accent-accent-cyan"
                        aria-label={`${ch.label} contrast min`}
                    />
                    {/* Contrast max slider */}
                    <input
                        type="range"
                        min={ch.contrastRange[0]}
                        max={ch.contrastRange[1]}
                        value={ch.contrastLimits[1]}
                        onChange={(e) => {
                            const hi = Number(e.target.value);
                            const lo = Math.min(ch.contrastLimits[0], hi - 1);
                            actions.setChannelProp(i, { contrastLimits: [lo, hi] });
                        }}
                        className="h-1 w-12 shrink-0 accent-accent-cyan"
                        aria-label={`${ch.label} contrast max`}
                    />
                    {/* Numeric display */}
                    <span className="w-16 shrink-0 font-mono text-[9px] text-text tabular-nums">
                        {ch.contrastLimits[0]}&ndash;{ch.contrastLimits[1]}
                    </span>
                </div>
            ))}
        </div>
    );
}
