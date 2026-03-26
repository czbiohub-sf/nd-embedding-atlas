import { useEffect, useMemo, useRef } from "react";
import { useViewer } from "../../hooks/useViewer";
import type { BlendMode } from "./ViewerContext";

// biome-ignore lint/suspicious/noExplicitAny: Tweakpane types incomplete without @tweakpane/core
type TweakPane = any;

interface ChannelParams {
    visible: boolean;
    color: string;
    blend: string;
    min: number;
    max: number;
}

const BLEND_OPTIONS: { text: string; value: string }[] = [
    { text: "Add", value: "additive" },
    { text: "Norm", value: "normal" },
    { text: "Mul", value: "multiply" },
    { text: "Sub", value: "subtractive" },
];

export function ChannelControls() {
    const { state, actions } = useViewer();
    const { channels, viewMode } = state;
    const containerRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<TweakPane>(null);
    // Stable refs so Tweakpane handlers always see latest values
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const channelsRef = useRef(channels);
    channelsRef.current = channels;
    // Stable per-channel param objects mutated in place for pane.refresh()
    const channelParamsRef = useRef<ChannelParams[]>([]);

    // Structural key — changes only when channel count, labels, or contrast ranges
    // change, not on every contrastLimits slider move. Used as a dep below to avoid
    // rebuilding the entire Tweakpane pane on every render.
    const channelStructureKey = useMemo(
        () => channels.map((ch) => `${ch.label}|${ch.contrastRange[0]}-${ch.contrastRange[1]}`).join(","),
        [channels],
    );

    // ── Sync value changes without rebuilding the pane ────────────────
    // Keep params in sync with React state so future rebuilds use the latest values.
    // No pane.refresh() — all changes originate from Tweakpane handlers (which already
    // write back to params via writePrimitive), so refreshing would fight the drag state.
    useEffect(() => {
        const params = channelParamsRef.current;
        if (params.length !== channels.length) return;
        channels.forEach((ch, i) => {
            params[i].visible = ch.visible;
            params[i].color = `#${ch.color}`;
            params[i].blend = ch.blendMode;
            params[i].min = ch.contrastLimits[0];
            params[i].max = ch.contrastLimits[1];
        });
    }, [channels]);

    // ── Rebuild pane on structural changes only ───────────────────────
    // Reads channelStructureKey to register it as a dep (rebuild trigger), then reads
    // all channel data via channelsRef so the closure never captures stale values.
    useEffect(() => {
        void channelStructureKey;
        const el = containerRef.current;
        const channels = channelsRef.current;
        if (!el || channels.length === 0) return;

        // Initialise stable param objects from current channel state
        channelParamsRef.current = channels.map((ch) => ({
            visible: ch.visible,
            color: `#${ch.color}`,
            blend: ch.blendMode,
            min: ch.contrastLimits[0],
            max: ch.contrastLimits[1],
        }));

        let disposed = false;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const pane = new Pane({ container: el, title: "Channels" }) as TweakPane;
            paneRef.current = pane;

            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i];
                const p = channelParamsRef.current[i];
                const folder = pane.addFolder({ title: ch.label, expanded: ch.visible });

                folder.addBinding(p, "visible").on("change", (ev: { value: boolean }) => {
                    actionsRef.current.setChannelProp(i, { visible: ev.value });
                });

                folder.addBinding(p, "color").on("change", (ev: { value: string }) => {
                    actionsRef.current.setChannelProp(i, { color: ev.value.replace("#", "").toUpperCase() });
                });

                if (viewMode === "2d") {
                    folder
                        .addBinding(p, "blend", {
                            options: Object.fromEntries(BLEND_OPTIONS.map((o) => [o.text, o.value])),
                        })
                        .on("change", (ev: { value: string }) => {
                            actionsRef.current.setChannelProp(i, { blendMode: ev.value as BlendMode });
                        });
                }

                // Step derived from range so fractional ranges (e.g. [-0.3, 0.3]) still work.
                const contrastStep = (ch.contrastRange[1] - ch.contrastRange[0]) / 200 || 1;

                folder
                    .addBinding(p, "min", {
                        min: ch.contrastRange[0],
                        max: ch.contrastRange[1],
                        step: contrastStep,
                    })
                    .on("change", (ev: { value: number }) => {
                        const current = channelsRef.current[i];
                        const hi = Math.min(Math.max(ev.value, current.contrastLimits[1]), current.contrastRange[1]);
                        actionsRef.current.setChannelProp(i, { contrastLimits: [ev.value, hi] });
                    });

                folder
                    .addBinding(p, "max", {
                        min: ch.contrastRange[0],
                        max: ch.contrastRange[1],
                        step: contrastStep,
                    })
                    .on("change", (ev: { value: number }) => {
                        const current = channelsRef.current[i];
                        const lo = Math.max(Math.min(current.contrastLimits[0], ev.value), current.contrastRange[0]);
                        actionsRef.current.setChannelProp(i, { contrastLimits: [lo, ev.value] });
                    });
            }
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [viewMode, channelStructureKey]);

    if (channels.length === 0) return null;

    return <div ref={containerRef} className="tp-channels" />;
}
