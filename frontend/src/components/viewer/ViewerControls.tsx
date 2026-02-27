import { useCallback, useMemo } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useViewer } from "../../hooks/useViewer";
import { ZRangeSlider } from "./RangeSlider";
import { ViewModeToggle } from "./ViewModeToggle";

interface Props {
    cropSize: number;
    setCropSize: (size: number) => void;
}

export function ViewerControls({ cropSize, setCropSize }: Props) {
    const { state: dashState, actions: dashActions } = useDashboard();
    const { state, actions } = useViewer();
    const { bounds, zIndex, tIndex, viewMode, zRange } = state;
    const { trajectory, metadata } = dashState;
    const hasCellCoords = !!metadata.spatial?.x_col;

    // When trajectory is active, override T slider to only the timepoints in the track
    const traj = trajectory?.points;
    const trajTimepoints = useMemo(() => (traj ? traj.map((p) => p.t) : null), [traj]);
    const isTrajectoryMode = trajTimepoints != null && trajTimepoints.length > 0;

    const effectiveTMax = isTrajectoryMode ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);

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

    const hasZ = bounds.zMax !== null && bounds.zMax > 0;

    return (
        <div className="flex flex-col gap-0.5">
            {/* T slider */}
            {(bounds.tMax !== null && bounds.tMax > 0) || isTrajectoryMode ? (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text-primary">T{isTrajectoryMode ? "*" : ""}</span>
                    <input
                        type="range"
                        min={0}
                        max={effectiveTMax}
                        value={effectiveTValue}
                        onChange={(e) => handleTChange(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Timepoint"
                    />
                    <span className="w-8 font-mono text-[10px] text-text-primary tabular-nums">{displayTValue}</span>
                </div>
            ) : null}

            {/* Z slider — single index in 2D, range in 3D */}
            {hasZ && (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text-primary">Z</span>
                    {viewMode === "2d" ? (
                        <input
                            type="range"
                            min={0}
                            max={bounds.zMax ?? 0}
                            value={zIndex}
                            onChange={(e) => actions.setZIndex(Number(e.target.value))}
                            className="h-1 flex-1 accent-accent-cyan"
                            aria-label="Z slice"
                        />
                    ) : (
                        <ZRangeSlider
                            min={0}
                            max={bounds.zMax ?? 0}
                            value={zRange ?? [0, bounds.zMax ?? 0]}
                            onChange={(range) => actions.setZRange(range)}
                        />
                    )}
                    <span className="w-12 font-mono text-[9px] text-text-muted tabular-nums">
                        {viewMode === "2d" ? zIndex : `${zRange?.[0] ?? 0}–${zRange?.[1] ?? bounds.zMax}`}
                    </span>
                </div>
            )}

            {/* Crop size */}
            {hasCellCoords && (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text-primary">bbox</span>
                    <input
                        type="range"
                        min={50}
                        max={500}
                        value={cropSize}
                        onChange={(e) => setCropSize(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Bounding box size"
                    />
                    <span className="w-8 font-mono text-[10px] text-text-primary tabular-nums">{cropSize}</span>
                </div>
            )}

            {/* 2D/3D toggle — right-aligned */}
            <div className="flex justify-end">
                <ViewModeToggle />
            </div>
        </div>
    );
}
