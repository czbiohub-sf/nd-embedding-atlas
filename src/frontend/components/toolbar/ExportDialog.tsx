import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDashboard } from "../../hooks/useDashboard";
import { predicateToSql, toRows } from "../../lib/mosaic-helpers";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";

interface DatasetBreakdown {
  _dataset: string;
  n: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filtered: number;
}

export default function ExportDialog({ open, onOpenChange, filtered }: Props) {
  const { state, meta } = useDashboard();
  const [filename, setFilename] = useState("export");
  const [breakdown, setBreakdown] = useState<DatasetBreakdown[]>([]);
  const predicateSqlRef = useRef<string | null>(null);

  const exportDir = state.metadata.export_dir;
  const sanitizedFilename = useMemo(() => {
    const name = filename.replace(/[/\\]/g, "").replace(/[^\w\-.]/g, "_");
    return name || "export";
  }, [filename]);
  const previewPath = exportDir ? `${exportDir}/${sanitizedFilename}.zarr` : null;

  // Tracks any setInterval started by handleExport so we can clear it on
  // unmount. Without this the poll runs forever and the loading toast
  // remains if the user navigates away mid-export.
  const pollIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (pollIdRef.current) clearInterval(pollIdRef.current);
    };
  }, []);

  // Snapshot predicate + query dataset breakdown when dialog opens
  useEffect(() => {
    if (!open) return;
    predicateSqlRef.current = predicateToSql(meta.brushSelection);
    const predicate = predicateSqlRef.current;
    const hasDatasetCol = state.metadata.obs_columns?.includes("_dataset");
    if (predicate && hasDatasetCol) {
      const sql = `SELECT _dataset, COUNT(*) as n FROM ${meta.table} WHERE ${predicate} GROUP BY _dataset ORDER BY n DESC`;
      void meta.coordinator.query(sql, { type: "json" }).then((result: unknown) => {
        setBreakdown(toRows<DatasetBreakdown>(result));
      });
    }
  }, [open, meta.brushSelection, meta.coordinator, meta.table, state.metadata.obs_columns]);

  const handleExport = useCallback(async () => {
    if (!filename.trim()) return;
    onOpenChange(false);

    const toastId = toast.loading(`Exporting ${filtered.toLocaleString()} observations…`);

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
        toast.error("Another export is already in progress.", { id: toastId });
        return;
      }
      if (!res.ok) {
        toast.error(data.error ?? "Export failed", { id: toastId });
        return;
      }

      if (pollIdRef.current) clearInterval(pollIdRef.current);
      const stop = () => {
        if (pollIdRef.current) {
          clearInterval(pollIdRef.current);
          pollIdRef.current = null;
        }
      };
      // eslint-disable-next-line no-misused-promises
      pollIdRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/export/${data.task_id}/status`);
          const statusData = await statusRes.json();
          if (statusData.status === "done") {
            stop();
            toast.success(`Export complete — ${statusData.n_obs?.toLocaleString()} observations`, {
              id: toastId,
              description: statusData.output_path,
              duration: 8000,
            });
          } else if (statusData.status === "error") {
            stop();
            toast.error(statusData.error ?? "Export failed", { id: toastId });
          }
        } catch {
          stop();
          toast.error("Failed to check export status", { id: toastId });
        }
      }, 1000);
    } catch {
      toast.error("Failed to start export", { id: toastId });
    }
  }, [filename, filtered, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Selection</DialogTitle>
          <p className="font-mono text-2xs text-muted-foreground tabular-nums">
            {filtered.toLocaleString()} observations
          </p>
        </DialogHeader>

        {/* Dataset breakdown */}
        {breakdown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {breakdown.map((d) => (
              <span
                key={d._dataset}
                className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 font-mono text-3xs"
              >
                <span className="text-foreground">{d._dataset}</span>
                <span className="text-muted-foreground">{d.n.toLocaleString()}</span>
              </span>
            ))}
          </div>
        )}

        {/* Filename input */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="export-filename" className="text-muted-foreground text-xs">
            Filename
          </label>
          <InputGroup>
            <InputGroupInput
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && filename.trim()) void handleExport();
              }}
              // biome-ignore lint/a11y/noAutofocus: intentional — first field in a modal
              autoFocus
            />
            <InputGroupAddon align="inline-end" className="self-stretch border-input border-l bg-muted px-2.5 py-0">
              .zarr
            </InputGroupAddon>
          </InputGroup>
          {previewPath && (
            <p className="truncate font-mono text-3xs text-muted-foreground" title={previewPath}>
              {previewPath}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!filename.trim()}
            onClick={() => {
              void handleExport();
            }}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
