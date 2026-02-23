import { useViewer } from "../../hooks/useViewer";

export function ChannelControls() {
    const { state, actions } = useViewer();
    const { channels } = state;

    if (channels.length === 0) return null;

    return (
        <div className="flex flex-col gap-0.5">
            {channels.map((ch, i) => (
                <div key={i} className="flex items-center gap-1.5">
                    {/* Visibility toggle */}
                    <button
                        type="button"
                        onClick={() => actions.setChannelProp(i, { visible: !ch.visible })}
                        className="flex w-4 shrink-0 items-center justify-center text-[10px] leading-none text-text hover:text-accent-cyan"
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
