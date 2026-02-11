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

    // When trajectory is active, override T slider range to track's time span
    const traj = trajectory?.points;
    const trajMin = traj ? traj[0].t : null;
    const trajMax = traj ? traj[traj.length - 1].t : null;
    const isTrajectoryMode = trajMin != null && trajMax != null;

    const effectiveTMin = isTrajectoryMode ? trajMin : 0;
    const effectiveTMax = isTrajectoryMode ? trajMax : (bounds.tMax ?? 0);
    const effectiveTValue = isTrajectoryMode ? (trajectory?.tIndex ?? trajMin) : tIndex;

    const handleTChange = (t: number) => {
        actions.setTIndex(t);
        if (isTrajectoryMode) {
            dashActions.setTrajectoryTIndex(t);
        }
    };

    return (
        <div className="absolute right-0 bottom-0 left-0 z-10 flex flex-col gap-0.5 bg-surface/80 px-2 py-1 backdrop-blur-sm">
            {(bounds.tMax !== null && bounds.tMax > 0) || isTrajectoryMode ? (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text-muted">T{isTrajectoryMode ? "*" : ""}</span>
                    <input
                        type="range"
                        min={effectiveTMin}
                        max={effectiveTMax}
                        value={effectiveTValue}
                        onChange={(e) => handleTChange(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Timepoint"
                    />
                    <span className="w-8 font-mono text-[10px] text-text-muted tabular-nums">{effectiveTValue}</span>
                </div>
            ) : null}
            {bounds.zMax !== null && bounds.zMax > 0 && (
                <div className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[10px] text-text-muted">Z</span>
                    <input
                        type="range"
                        min={0}
                        max={bounds.zMax}
                        value={zIndex}
                        onChange={(e) => actions.setZIndex(Number(e.target.value))}
                        className="h-1 flex-1 accent-accent-cyan"
                        aria-label="Z slice"
                    />
                    <span className="w-8 font-mono text-[10px] text-text-muted tabular-nums">{zIndex}</span>
                </div>
            )}
            <div className="flex items-center gap-2">
                <span className="w-6 font-mono text-[10px] text-text-muted">crop</span>
                <input
                    type="range"
                    min={50}
                    max={500}
                    value={cropSize}
                    onChange={(e) => setCropSize(Number(e.target.value))}
                    className="h-1 flex-1 accent-accent-cyan"
                    aria-label="Crop size"
                />
                <span className="w-8 font-mono text-[10px] text-text-muted tabular-nums">{cropSize}</span>
            </div>
        </div>
    );
}
