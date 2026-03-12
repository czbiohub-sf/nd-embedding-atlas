import { useEffect, useRef } from "react";
import { jsonFetcher } from "../../lib/fetcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TweakPane = any;

interface PointInfoPaneProps {
    highlightId: string | null;
    additionalFields: string[];
    onShowTrajectory: (trackId: number, fovName: string, clickedT?: number) => void;
}

export function PointInfoPane({
    highlightId,
    additionalFields,
    onShowTrajectory,
}: PointInfoPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const paneRef = useRef<TweakPane>(null);
    const paramsRef = useRef<Record<string, string>>({});
    const onShowTrajectoryRef = useRef(onShowTrajectory);
    onShowTrajectoryRef.current = onShowTrajectory;

    // Create the pane once, with stable structure
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        let disposed = false;
        const fields = ["__row_index__", ...additionalFields];

        // Initialize params with empty strings
        const params: Record<string, string> = {};
        for (const key of fields) {
            params[key] = "—";
        }
        paramsRef.current = params;

        import("tweakpane").then(({ Pane }) => {
            if (disposed) return;

            const pane = new Pane({ container: el, title: "Point Info" }) as TweakPane;
            paneRef.current = pane;

            for (const key of fields) {
                pane.addBinding(params, key, { readonly: true });
            }

            // Trajectory button — always present, handler reads latest row from ref
            pane.addButton({ title: "\u2192 Show Trajectory" }).on("click", () => {
                const p = paramsRef.current;
                const trackId = p.track_id;
                const fovName = p.fov_name;
                if (trackId && trackId !== "—" && fovName && fovName !== "—") {
                    onShowTrajectoryRef.current(
                        Number(trackId),
                        String(fovName),
                        p.t && p.t !== "—" ? Number(p.t) : undefined,
                    );
                }
            });
        });

        return () => {
            disposed = true;
            paneRef.current?.dispose();
            paneRef.current = null;
        };
    }, [additionalFields]);

    // Update values when highlightId changes — fetch directly from server, bypassing Mosaic
    useEffect(() => {
        if (!highlightId) return;

        let cancelled = false;
        const fields = ["__row_index__", ...additionalFields];

        jsonFetcher(`/api/obs/${highlightId}/detail`).then(
            (row: Record<string, string | null>) => {
                if (cancelled) return;
                const params = paramsRef.current;
                for (const key of fields) {
                    params[key] = row[key] != null ? String(row[key]) : "—";
                }
                paneRef.current?.refresh();
            },
            (err) => {
                console.error("PointInfoPane fetch failed:", err);
            },
        );

        return () => {
            cancelled = true;
        };
    }, [highlightId, additionalFields]);

    return <div ref={containerRef} className="tp-point-info" />;
}
