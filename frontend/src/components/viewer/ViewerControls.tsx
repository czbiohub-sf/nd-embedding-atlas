import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { useViewer } from "../../hooks/useViewer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tweakpane types incomplete without @tweakpane/core
type TweakPane = any;

interface Props {
    cropSize: number;
    setCropSize: (size: number) => void;
}

export function ViewerControls({ cropSize, setCropSize }: Props) {
    const { state: dashState, actions: dashActions } = useDashboard();
    const { state, actions } = useViewer();
    const { bounds, zIndex, tIndex, viewMode } = state;
    const { trajectory, metadata } = dashState;
    const hasCellCoords = !!metadata.spatial?.x_col;

    const traj = trajectory?.points;
    const trajTimepoints = useMemo(() => (traj ? traj.map((p) => p.t) : null), [traj]);
    const isTrajectoryMode = trajTimepoints != null && trajTimepoints.length > 0;

    const effectiveTMax = isTrajectoryMode ? trajTimepoints.length - 1 : (bounds.tMax ?? 0);
    const hasT = effectiveTMax > 0 || isTrajectoryMode;
    const hasZ = bounds.zMax !== null && bounds.zMax > 0;

    const containerRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<TweakPane>(null);

    // Stable refs for handlers
    const actionsRef = useRef(actions);
    actionsRef.current = actions;
    const dashActionsRef = useRef(dashActions);
    dashActionsRef.current = dashActions;
    const setCropSizeRef = useRef(setCropSize);
    setCropSizeRef.current = setCropSize;
    const trajTimepointsRef = useRef(trajTimepoints);
    trajTimepointsRef.current = trajTimepoints;
    const isTrajectoryModeRef = useRef(isTrajectoryMode);
    isTrajectoryModeRef.current = isTrajectoryMode;

    const handleTChange = useCallback((sliderVal: number) => {
        if (isTrajectoryModeRef.current && trajTimepointsRef.current) {
            const t = trajTimepointsRef.current[sliderVal];
            actionsRef.current.setTIndex(t);
            dashActionsRef.current.setTrajectoryTIndex(t);
        } else {
            actionsRef.current.setTIndex(sliderVal);
        }
    }, []);

    // Dep key to rebuild pane when structure changes
    const _structureKey = `${hasT}:${hasZ}:${hasCellCoords}:${viewMode}:${effectiveTMax}:${bounds.zMax}:${isTrajectoryMode}`;

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let disposed = false;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const pane = new Pane({ container: el, title: "Dimensions" }) as TweakPane;
            paneRef.current = pane;

            // T slider — label changes to "T*" in trajectory mode
            if (hasT) {
                const tLabel = isTrajectoryMode ? "T*" : "T";
                const tParams = { [tLabel]: tIndex };
                pane.addBinding(tParams, tLabel, { min: 0, max: effectiveTMax, step: 1 }).on(
                    "change",
                    (ev: { value: number }) => handleTChange(Math.round(ev.value)),
                );
            }

            // Z slider (2D only — 3D uses range which is harder in Tweakpane, keep native for now)
            if (hasZ && viewMode === "2d") {
                const zParams = { Z: zIndex };
                pane.addBinding(zParams, "Z", { min: 0, max: bounds.zMax ?? 0, step: 1 }).on(
                    "change",
                    (ev: { value: number }) => actionsRef.current.setZIndex(Math.round(ev.value)),
                );
            }

            // Crop size
            if (hasCellCoords) {
                const cropParams = { bbox: cropSize };
                pane.addBinding(cropParams, "bbox", { min: 50, max: 500, step: 10 }).on(
                    "change",
                    (ev: { value: number }) => setCropSizeRef.current(Math.round(ev.value)),
                );
            }

            // View mode button (2D/3D)
            if (hasZ) {
                const modeParams = { "3D": viewMode === "3d" };
                pane.addBinding(modeParams, "3D").on("change", (ev: { value: boolean }) => {
                    actionsRef.current.setViewMode(ev.value ? "3d" : "2d");
                });
            }
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [
        bounds.zMax,
        cropSize,
        effectiveTMax,
        handleTChange,
        hasCellCoords,
        hasT,
        hasZ,
        isTrajectoryMode,
        tIndex,
        viewMode,
        zIndex,
    ]);

    return <div ref={containerRef} className="tp-viewer-controls" />;
}
