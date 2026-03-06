import type { Coordinator } from "@uwdata/mosaic-core";
import { useEffect, useRef } from "react";
import { toRows } from "../../lib/mosaic-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TweakPane = any;

interface PointInfoPaneProps {
    highlightId: string | null;
    coordinator: Coordinator;
    table: string;
    additionalFields: string[];
    onShowTrajectory: (trackId: number, fovName: string, clickedT?: number) => void;
}

export function PointInfoPane({
    highlightId,
    coordinator,
    table,
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

    // Update values when highlightId changes — no pane rebuild
    useEffect(() => {
        if (!highlightId) return;

        let cancelled = false;
        const fields = ["__row_index__", ...additionalFields];
        const fieldList = fields.map((f) => `"${f}"`).join(", ");
        const sql = `SELECT ${fieldList} FROM ${table} WHERE "__row_index__" = ${Number(highlightId)} LIMIT 1`;

        coordinator.query(sql, { type: "json" }).then(
            (result) => {
                if (cancelled) return;
                const rows = toRows<Record<string, unknown>>(result);
                if (rows.length === 0) return;
                const row = rows[0];

                const params = paramsRef.current;
                for (const key of fields) {
                    params[key] = row[key] != null ? String(row[key]) : "—";
                }

                // Refresh all bindings to pick up the new values
                paneRef.current?.refresh();
            },
            (err) => {
                console.error("PointInfoPane query failed:", err);
            },
        );

        return () => {
            cancelled = true;
        };
    }, [highlightId, coordinator, table, additionalFields]);

    return <div ref={containerRef} className="tp-point-info" />;
}
