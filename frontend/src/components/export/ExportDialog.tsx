import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { predicateToSql, toRows } from "../../lib/mosaic-helpers";

interface DatasetBreakdown {
    _dataset: string;
    n: number;
}

interface Props {
    filtered: number;
    onClose: () => void;
}

type Status = "idle" | "running" | "done" | "error";

export default function ExportDialog({ filtered, onClose }: Props) {
    const { state, meta } = useDashboard();
    const panelRef = useRef<HTMLDivElement>(null);

    const [filename, setFilename] = useState("export");
    const [_taskId, setTaskId] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("idle");
    const [outputPath, setOutputPath] = useState<string | null>(null);
    const [nObs, setNObs] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [breakdown, setBreakdown] = useState<DatasetBreakdown[]>([]);

    // Snapshot predicate at mount time
    const predicateSqlRef = useRef<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Reactive path preview — updates as user types filename
    const exportDir = state.metadata.export_dir;
    const sanitizedFilename = useMemo(() => {
        const name = filename.replace(/[/\\]/g, "").replace(/[^\w\-.]/g, "_");
        return name || "export";
    }, [filename]);
    const previewPath = exportDir ? `${exportDir}/${sanitizedFilename}.zarr` : null;

    // Snapshot predicate and query dataset breakdown
    useEffect(() => {
        predicateSqlRef.current = predicateToSql(meta.brushSelection);

        const predicate = predicateSqlRef.current;
        const hasDatasetCol = state.metadata.obs_columns?.includes("_dataset");
        if (predicate && hasDatasetCol) {
            const sql = `SELECT _dataset, COUNT(*) as n FROM ${meta.table} WHERE ${predicate} GROUP BY _dataset ORDER BY n DESC`;
            meta.coordinator.query(sql, { type: "json" }).then((result: unknown) => {
                const rows = toRows<DatasetBreakdown>(result);
                setBreakdown(rows);
            });
        }

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [meta.brushSelection, meta.coordinator, meta.table, state.metadata.obs_columns]);

    // Cleanup poll interval on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // Focus filename input on open
    const filenameRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        filenameRef.current?.focus();
    }, []);

    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    const handleClose = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        onClose();
    };

    const handleExport = async () => {
        setStatus("running");
        setError(null);

        try {
            const res = await fetch("/api/export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    predicate: predicateSqlRef.current,
                    filename,
                    selection_type: "unknown",
                    embedding_key: null,
                }),
            });

            const data = await res.json();

            if (res.status === 409) {
                setError("Another export is already in progress.");
                setStatus("error");
                return;
            }

            if (!res.ok) {
                setError(data.error ?? "Export failed");
                setStatus("error");
                return;
            }

            setTaskId(data.task_id);

            pollRef.current = setInterval(async () => {
                try {
                    const statusRes = await fetch(`/api/export/${data.task_id}/status`);
                    const statusData = await statusRes.json();

                    if (statusData.status === "done") {
                        setStatus("done");
                        setOutputPath(statusData.output_path);
                        setNObs(statusData.n_obs);
                        if (pollRef.current) clearInterval(pollRef.current);
                    } else if (statusData.status === "error") {
                        setStatus("error");
                        setError(statusData.error ?? "Export failed");
                        if (pollRef.current) clearInterval(pollRef.current);
                    }
                } catch {
                    setStatus("error");
                    setError("Failed to check export status");
                    if (pollRef.current) clearInterval(pollRef.current);
                }
            }, 1000);
        } catch {
            setError("Failed to start export");
            setStatus("error");
        }
    };

    return (
        <>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is mouse-only by design (Escape handled separately) */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: intentional invisible backdrop */}
            <div className="fixed inset-0 z-40" onClick={handleClose} />

            {/* Dropdown panel anchored to parent's relative container */}
            <div
                ref={panelRef}
                className="absolute top-full right-1/2 z-50 mt-1.5 w-[380px] translate-x-1/2 rounded-lg border border-border-subtle bg-elevated shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
            >
                <div className="p-4">
                    {/* Header */}
                    <div className="mb-4 flex items-start justify-between">
                        <div>
                            <h2 className="font-medium text-sm text-text-primary tracking-wide">Export Selection</h2>
                            <p className="mt-0.5 font-mono text-[11px] text-text-secondary tabular-nums">
                                {filtered.toLocaleString()} observations
                            </p>
                        </div>
                        <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface hover:text-text-secondary"
                            onClick={handleClose}
                            aria-label="Close"
                        >
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 10 10"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                aria-hidden="true"
                            >
                                <path d="M1 1l8 8M9 1l-8 8" />
                            </svg>
                        </button>
                    </div>

                    {/* Dataset breakdown pills */}
                    {breakdown.length > 0 && (
                        <div className="mb-3 flex flex-wrap gap-1.5">
                            {breakdown.map((d) => (
                                <span
                                    key={d._dataset}
                                    className="inline-flex items-center gap-1.5 rounded bg-surface px-2 py-0.5 font-mono text-[10px]"
                                >
                                    <span className="text-text-secondary">{d._dataset}</span>
                                    <span className="text-text-muted">{d.n.toLocaleString()}</span>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Filename input */}
                    <div className="mb-1.5">
                        <label htmlFor="export-filename" className="mb-1 block text-[11px] text-text-muted">
                            Filename
                        </label>
                        <div className="flex items-center gap-0 overflow-hidden rounded border border-border-subtle transition-colors focus-within:border-accent-cyan">
                            <input
                                ref={filenameRef}
                                id="export-filename"
                                type="text"
                                value={filename}
                                onChange={(e) => setFilename(e.target.value)}
                                disabled={status === "running" || status === "done"}
                                className="min-w-0 flex-1 border-none bg-surface px-2.5 py-1.5 font-mono text-text-primary text-xs outline-none disabled:opacity-40"
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && status === "idle" && filename.trim()) handleExport();
                                }}
                            />
                            <span className="border-border-subtle border-l bg-elevated px-2.5 py-1.5 font-mono text-text-muted text-xs">
                                .zarr
                            </span>
                        </div>
                    </div>

                    {/* Path preview */}
                    {previewPath && status === "idle" && (
                        <div className="mb-4 truncate font-mono text-[10px] text-text-muted" title={previewPath}>
                            {previewPath}
                        </div>
                    )}
                    {(!previewPath || status !== "idle") &&
                        status !== "running" &&
                        status !== "done" &&
                        status !== "error" && <div className="mb-4" />}

                    {/* Running */}
                    {status === "running" && (
                        <div className="mb-4">
                            <div className="h-0.5 overflow-hidden rounded-full bg-surface">
                                <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-accent-cyan" />
                            </div>
                            <div className="mt-1.5 font-mono text-[11px] text-text-muted">Exporting...</div>
                        </div>
                    )}

                    {/* Success */}
                    {status === "done" && outputPath && (
                        <div className="mb-4 rounded border border-accent-cyan/20 bg-accent-cyan/5 p-3">
                            <div className="flex items-center gap-1.5 text-accent-cyan text-xs">
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                    <path
                                        d="M2.5 6.5L4.5 8.5L9.5 3.5"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                Export complete — {nObs?.toLocaleString()} observations
                            </div>
                            <div className="mt-1.5 break-all font-mono text-[10px] text-text-muted">{outputPath}</div>
                        </div>
                    )}

                    {/* Error */}
                    {status === "error" && error && (
                        <div className="mb-4 rounded border border-accent-rose/20 bg-accent-rose/5 p-3 text-accent-rose text-xs">
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            className="rounded px-3 py-1.5 text-text-secondary text-xs transition-colors hover:bg-surface hover:text-text-primary"
                            onClick={handleClose}
                        >
                            {status === "done" ? "Close" : "Cancel"}
                        </button>
                        {status !== "done" && (
                            <button
                                type="button"
                                className="rounded bg-accent-cyan/90 px-4 py-1.5 font-medium text-[#0c1021] text-xs transition-all hover:bg-accent-cyan disabled:cursor-not-allowed disabled:opacity-30"
                                disabled={status === "running" || !filename.trim()}
                                onClick={handleExport}
                            >
                                {status === "running" ? "Exporting..." : "Export"}
                            </button>
                        )}
                    </div>
                </div>

                <style>{`
                    @keyframes shimmer {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(400%); }
                    }
                `}</style>
            </div>
        </>
    );
}
