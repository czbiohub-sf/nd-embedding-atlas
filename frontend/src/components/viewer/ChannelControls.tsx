import { useEffect, useRef } from "react";
import { useViewer } from "../../hooks/useViewer";
import type { BlendMode } from "./ViewerContext";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tweakpane types incomplete without @tweakpane/core
type TweakPane = any;

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
    // Stable refs so Tweakpane handlers always see latest
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const channelsRef = useRef(channels);
    channelsRef.current = channels;

    useEffect(() => {
        const el = containerRef.current;
        if (!el || channels.length === 0) return;

        let disposed = false;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const pane = new Pane({ container: el, title: "Channels" }) as TweakPane;
            paneRef.current = pane;

            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i];
                const folder = pane.addFolder({ title: ch.label, expanded: ch.visible });

                // Visibility binding
                const visParams = { visible: ch.visible };
                folder.addBinding(visParams, "visible").on("change", (ev: { value: boolean }) => {
                    actionsRef.current.setChannelProp(i, { visible: ev.value });
                });

                // Color binding (channel stores "FF0000", Tweakpane uses "#ff0000")
                const colorParams = { color: `#${ch.color}` };
                folder.addBinding(colorParams, "color").on("change", (ev: { value: string }) => {
                    actionsRef.current.setChannelProp(i, { color: ev.value.replace("#", "").toUpperCase() });
                });

                // Blend mode (2D only)
                if (viewMode === "2d") {
                    const blendParams = { blend: ch.blendMode };
                    folder
                        .addBinding(blendParams, "blend", {
                            options: Object.fromEntries(BLEND_OPTIONS.map((o) => [o.text, o.value])),
                        })
                        .on("change", (ev: { value: string }) => {
                            actionsRef.current.setChannelProp(i, { blendMode: ev.value as BlendMode });
                        });
                }

                // Contrast min slider
                const contrastParams = { min: ch.contrastLimits[0], max: ch.contrastLimits[1] };

                folder
                    .addBinding(contrastParams, "min", {
                        min: ch.contrastRange[0],
                        max: ch.contrastRange[1],
                        step: 1,
                    })
                    .on("change", (ev: { value: number }) => {
                        const current = channelsRef.current[i];
                        const hi = Math.max(ev.value + 1, current.contrastLimits[1]);
                        actionsRef.current.setChannelProp(i, { contrastLimits: [ev.value, hi] });
                    });

                folder
                    .addBinding(contrastParams, "max", {
                        min: ch.contrastRange[0],
                        max: ch.contrastRange[1],
                        step: 1,
                    })
                    .on("change", (ev: { value: number }) => {
                        const current = channelsRef.current[i];
                        const lo = Math.min(current.contrastLimits[0], ev.value - 1);
                        actionsRef.current.setChannelProp(i, { contrastLimits: [lo, ev.value] });
                    });
            }
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [channels, viewMode]);

    if (channels.length === 0) return null;

    return <div ref={containerRef} className="tp-channels" />;
}
