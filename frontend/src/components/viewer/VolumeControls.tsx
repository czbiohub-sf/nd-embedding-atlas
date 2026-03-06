import { useEffect, useRef, useState } from "react";
import { useViewer } from "../../hooks/useViewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tweakpane types incomplete without @tweakpane/core
type TweakPane = any;

interface VolumeSettings {
    opacityMultiplier: number;
    relativeStepSize: number;
}

const DEFAULTS: VolumeSettings = {
    opacityMultiplier: 1.0,
    relativeStepSize: 1.0,
};

export function VolumeControls() {
    const { state } = useViewer();
    const [settings, setSettings] = useState<VolumeSettings>(DEFAULTS);
    const containerRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<TweakPane>(null);
    const layersRef = useRef(state.layers);
    layersRef.current = state.layers;

    useEffect(() => {
        const el = containerRef.current;
        if (!el || state.viewMode !== "3d") return;

        let disposed = false;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const params = { opacity: settings.opacityMultiplier, step: settings.relativeStepSize };
            const pane = new Pane({ container: el, title: "Volume" }) as TweakPane;
            paneRef.current = pane;

            pane.addBinding(params, "opacity", { min: 0.01, max: 5, step: 0.1 }).on(
                "change",
                (ev: { value: number }) => {
                    setSettings((prev) => ({ ...prev, opacityMultiplier: ev.value }));
                    for (const { layer } of layersRef.current) {
                        if ("opacityMultiplier" in layer) {
                            (layer as unknown as Record<string, unknown>).opacityMultiplier = ev.value;
                        }
                    }
                },
            );

            pane.addBinding(params, "step", { min: 0.25, max: 3, step: 0.25 }).on("change", (ev: { value: number }) => {
                setSettings((prev) => ({ ...prev, relativeStepSize: ev.value }));
                for (const { layer } of layersRef.current) {
                    if ("relativeStepSize" in layer) {
                        (layer as unknown as Record<string, unknown>).relativeStepSize = ev.value;
                    }
                }
            });
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [state.viewMode, settings.opacityMultiplier, settings.relativeStepSize]);

    if (state.viewMode !== "3d") return null;

    return <div ref={containerRef} className="tp-volume-controls" />;
}
