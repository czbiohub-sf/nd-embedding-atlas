import { useCallback, useMemo } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useViewer } from "../../hooks/useViewer";

interface Props {
    cropSize: number;
    setCropSize: (size: number) => void;
}

export function ViewerControls({ cropSize, setCropSize }: Props) {
    const { state: dashState, actions: dashActions } = useDashboard();
    const { state, actions } = useViewer();
    const { bounds, zIndex, tIndex } = state;
    const { trajectory } = dashState;

    // When trajectory is active, override T slider to only the timepoints in the track
    const traj = trajectory?.points;
    const trajTimepoints = useMemo(() => (traj ? traj.map((p) => p.t) : null), [traj]);
    const isTrajectoryMode = trajTimepoints != null && trajTimepoints.length > 0;

    const effectiveTMin = isTrajectoryMode ? 0 : 0;
    const effectiveTMax = isTrajectoryMode ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);

    // In trajectory mode, slider position is the index into trajTimepoints; display the actual T value
    const trajCurrentIdx = isTrajectoryMode
        ? Math.max(0, trajTimepoints.indexOf(trajectory?.tIndex ?? trajTimepoints[0]))
        : 0;
    const effectiveTValue = isTrajectoryMode ? trajCurrentIdx : tIndex;
    const displayTValue = isTrajectoryMode ? trajTimepoints[trajCurrentIdx] : tIndex;

    const handleTChange = useCallback(
        (sliderVal: number) => {
            if (isTrajectoryMode && trajTimepoints) {
                const t = trajTimepoints[sliderVal];
                actions.setTIndex(t);
                dashActions.setTrajectoryTIndex(t);
            } else {
                actions.setTIndex(sliderVal);
            }
        },
        [isTrajectoryMode, trajTimepoints, actions, dashActions],
    );

    return (
        <div className="flex flex-col gap-0.5">
            {(bounds.tMax !== null && bounds.tMax > 0) || isTrajectoryMode ? (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text">T{isTrajectoryMode ? "*" : ""}</span>
                    <input
                        type="range"
                        min={effectiveTMin}
                        max={effectiveTMax}
                        value={effectiveTValue}
                        onChange={(e) => handleTChange(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Timepoint"
                    />
                    <span className="w-8 font-mono text-[10px] text-text tabular-nums">{displayTValue}</span>
                </div>
            ) : null}
            {bounds.zMax !== null && bounds.zMax > 0 && (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text">Z</span>
                    <input
                        type="range"
                        min={0}
                        max={bounds.zMax}
                        value={zIndex}
                        onChange={(e) => actions.setZIndex(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Z slice"
                    />
                    <span className="w-8 font-mono text-[10px] text-text tabular-nums">{zIndex}</span>
                </div>
            )}
            <div className="flex items-center gap-2">
                <span className="w-6 font-mono text-[10px] text-text">crop</span>
                <input
                    type="range"
                    min={50}
                    max={500}
                    value={cropSize}
                    onChange={(e) => setCropSize(Number(e.target.value))}
                    className="h-1 flex-1 accent-accent-cyan"
                    aria-label="Crop size"
                />
                <span className="w-8 font-mono text-[10px] text-text tabular-nums">{cropSize}</span>
            </div>
        </div>
    );
}
