import { useCallback, useState } from "react";
import { useViewer } from "../../hooks/useViewer";

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

    const updateSetting = useCallback(
        <K extends keyof VolumeSettings>(key: K, value: VolumeSettings[K]) => {
            setSettings((prev) => ({ ...prev, [key]: value }));
            // Apply directly to VolumeLayer instances (imperative, not through React state)
            for (const { layer } of state.layers) {
                if (key in layer) {
                    (layer as unknown as Record<string, unknown>)[key] = value;
                }
            }
        },
        [state.layers],
    );

    if (state.viewMode !== "3d") return null;

    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 font-mono text-[10px] text-text-muted">opacity</span>
                <input
                    type="range"
                    min={0.01}
                    max={5}
                    step={0.1}
                    value={settings.opacityMultiplier}
                    onChange={(e) => updateSetting("opacityMultiplier", Number(e.target.value))}
                    className="h-1 w-16 shrink-0 accent-accent-cyan"
                    aria-label="Volume opacity"
                />
                <span className="w-6 font-mono text-[9px] text-text-muted tabular-nums">
                    {settings.opacityMultiplier.toFixed(1)}
                </span>
            </div>
            <div className="flex items-center gap-1.5">
                <span className="w-10 shrink-0 font-mono text-[10px] text-text-muted">step</span>
                <input
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.25}
                    value={settings.relativeStepSize}
                    onChange={(e) => updateSetting("relativeStepSize", Number(e.target.value))}
                    className="h-1 w-16 shrink-0 accent-accent-cyan"
                    aria-label="Volume step size"
                />
                <span className="w-6 font-mono text-[9px] text-text-muted tabular-nums">
                    {settings.relativeStepSize.toFixed(1)}
                </span>
            </div>
        </div>
    );
}
