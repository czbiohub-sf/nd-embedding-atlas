import { useEffect, useRef } from "react";
import { useViewer } from "../../hooks/useViewer";

// biome-ignore lint/suspicious/noExplicitAny: Tweakpane types incomplete without @tweakpane/core
type TweakPane = any;

// Opacity is stored as a [0,1] log-scale slider value; actual opacityMultiplier = 10^(v*4-3)
// This maps: 0 → 0.001, 0.5 → ~0.1, 0.75 → 1.0, 1.0 → 10.0
const opacityToMultiplier = (v: number) => 10 ** (v * 4 - 3);
const multiplierToOpacity = (m: number) => (Math.log10(m) + 3) / 4;

const DEFAULTS = { opacity: multiplierToOpacity(1.0), step: 1.0, earlyStop: 0.99 };

export function VolumeControls() {
    const { state } = useViewer();
    const containerRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<TweakPane>(null);
    const layersRef = useRef(state.layers);
    layersRef.current = state.layers;
    // Stable param object mutated in place — never triggers a pane rebuild
    const paramsRef = useRef({ ...DEFAULTS });

    useEffect(() => {
        const el = containerRef.current;
        if (!el || state.viewMode !== "3d") return;

        let disposed = false;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const pane = new Pane({ container: el, title: "Volume" }) as TweakPane;
            paneRef.current = pane;

            // Opacity — log scale: slider [0,1] → opacityMultiplier [0.001, 10]
            pane.addBinding(paramsRef.current, "opacity", { label: "opacity (log)", min: 0, max: 1, step: 0.01 }).on(
                "change",
                (ev: { value: number }) => {
                    const multiplier = opacityToMultiplier(ev.value);
                    for (const { layer } of layersRef.current) {
                        if ("opacityMultiplier" in layer) {
                            (layer as unknown as Record<string, unknown>).opacityMultiplier = multiplier;
                        }
                    }
                },
            );

            pane.addBinding(paramsRef.current, "step", { label: "step size", min: 0.25, max: 3, step: 0.25 }).on(
                "change",
                (ev: { value: number }) => {
                    for (const { layer } of layersRef.current) {
                        if ("relativeStepSize" in layer) {
                            (layer as unknown as Record<string, unknown>).relativeStepSize = ev.value;
                        }
                    }
                },
            );

            // Early termination — higher = more accurate, lower = faster
            pane.addBinding(paramsRef.current, "earlyStop", {
                label: "early stop α",
                min: 0.8,
                max: 1.0,
                step: 0.01,
            }).on("change", (ev: { value: number }) => {
                for (const { layer } of layersRef.current) {
                    if ("earlyTerminationAlpha" in layer) {
                        (layer as unknown as Record<string, unknown>).earlyTerminationAlpha = ev.value;
                    }
                }
            });
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [state.viewMode]);

    if (state.viewMode !== "3d") return null;

    return <div ref={containerRef} className="tp-volume-controls" />;
}
