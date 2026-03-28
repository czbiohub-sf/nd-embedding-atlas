/**
 * PointInfoPane — frosted-glass floating card showing obs metadata.
 * Replaces the Tweakpane-based implementation with a plain React component.
 * Will be replaced by PointHovercard in the next UX iteration.
 */
import { useEffect, useState } from "react";
import { jsonFetcher } from "../../lib/fetcher";

interface PointInfoPaneProps {
    highlightId: string | null;
    additionalFields: string[];
    onShowTrajectory: (trackId: number, fovName: string, clickedT?: number) => void;
}

export function PointInfoPane({ highlightId, additionalFields, onShowTrajectory }: PointInfoPaneProps) {
    const [row, setRow] = useState<Record<string, string | null> | null>(null);

    useEffect(() => {
        if (!highlightId) { setRow(null); return; }
        let cancelled = false;
        jsonFetcher(`/api/obs/${highlightId}/detail`).then(
            (data: Record<string, string | null>) => { if (!cancelled) setRow(data); },
            (err) => { console.error("PointInfoPane fetch failed:", err); },
        );
        return () => { cancelled = true; };
    }, [highlightId]);

    if (!highlightId || !row) return null;

    const fields = ["__row_index__", ...additionalFields];
    const trackId = row.track_id;
    const fovName = row.fov_name;
    const canShowTrajectory = trackId && trackId !== "—" && fovName && fovName !== "—";

    return (
        <div
            style={{
                background: "color-mix(in srgb, var(--color-base) 85%, transparent)",
                backdropFilter: "blur(8px)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 6,
                padding: "8px 10px",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-primary)",
                minWidth: 160,
            }}
        >
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Point Info
            </div>
            {fields.map((key) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "1px 0" }}>
                    <span style={{ color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{key}</span>
                    <span style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{row[key] ?? "—"}</span>
                </div>
            ))}
            {canShowTrajectory && (
                <button
                    onClick={() => onShowTrajectory(Number(trackId), String(fovName), row.t ? Number(row.t) : undefined)}
                    style={{
                        marginTop: 8,
                        width: "100%",
                        padding: "3px 0",
                        background: "var(--color-elevated)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: 3,
                        color: "var(--color-text-secondary)",
                        fontSize: 10,
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                    }}
                >
                    → Show Trajectory
                </button>
            )}
        </div>
    );
}
