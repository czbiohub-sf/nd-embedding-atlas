/**
 * ExportCollectionDialog — pick format/destination/filename for a server-side
 * export of a single collection. Submits to POST /api/collections/{id}/export.
 *
 * Behaviors:
 *   - Format radio (Parquet default — smaller, lossless types).
 *   - Output directory text input, prefilled from /api/export-dir.
 *   - Recent dirs chips persisted in localStorage (LRU, max 5).
 *   - Filename text input, prefilled with a slug of the collection name.
 *   - Path preview line shows the resolved filename including extension.
 *   - On 409 from server (file exists) → second-tier confirm step inside
 *     the dialog; user can confirm overwrite or cancel.
 */

import { Bookmark, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Collection } from "../../../protocol/index.ts";

const RECENT_DIRS_KEY = "ndea:collections:export-recent-dirs";
const MAX_RECENT_DIRS = 5;

function readRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_DIRS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function pushRecentDir(dir: string, defaultDir: string): void {
  if (dir === defaultDir) return; // skip the boring case
  try {
    const current = readRecentDirs().filter((d) => d !== dir);
    const next = [dir, ...current].slice(0, MAX_RECENT_DIRS);
    localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage unavailable */
  }
}

function defaultFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "collection"
  );
}

interface Props {
  collection: Collection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ExportSuccess {
  output_path: string;
  n_obs: number;
  size_bytes: number;
}

interface ConflictState {
  existing_path: string;
  existing_size_bytes: number;
}

export function ExportCollectionDialog({ collection, open, onOpenChange }: Props) {
  const [format, setFormat] = useState<"csv" | "parquet">("parquet");
  const [outputDir, setOutputDir] = useState("");
  const [filename, setFilename] = useState("");
  const [defaultDir, setDefaultDir] = useState("");
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);

  // Reset state every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFormat("parquet");
    setFilename(defaultFilename(collection.name));
    setSubmitting(false);
    setConflict(null);
    setGenericError(null);
    setRecentDirs(readRecentDirs());

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/export-dir");
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { default_dir: string };
        if (cancelled) return;
        setDefaultDir(data.default_dir);
        setOutputDir(data.default_dir);
      } catch {
        if (cancelled) return;
        setOutputDir("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, collection.name]);

  const ext = format === "csv" ? "csv" : "parquet";
  const previewPath = useMemo(() => {
    const dir = outputDir.replace(/\/+$/, "");
    const file = filename.trim().replace(/\.(csv|parquet)$/i, "");
    return `${dir}/${file || "<filename>"}.${ext}`;
  }, [outputDir, filename, ext]);

  const canSubmit = !submitting && outputDir.trim().length > 0 && filename.trim().length > 0;

  async function submit(overwrite: boolean) {
    if (!canSubmit) return;
    setSubmitting(true);
    setGenericError(null);
    const toastId = toast.loading(`Exporting ${collection.name} as ${format.toUpperCase()}…`);
    try {
      const res = await fetch(`/api/collections/${collection.collection_id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          output_dir: outputDir.trim(),
          filename: filename.trim(),
          overwrite,
        }),
      });

      if (res.status === 409) {
        const data = (await res.json()) as ConflictState;
        setConflict(data);
        toast.dismiss(toastId);
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as ExportSuccess;
      const sizeKb = Math.max(1, Math.round(data.size_bytes / 1024));
      toast.success(`Exported ${data.n_obs.toLocaleString()} obs · ${sizeKb.toLocaleString()} KB`, {
        id: toastId,
        description: data.output_path,
        duration: 8000,
      });
      pushRecentDir(outputDir.trim(), defaultDir);
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      toast.error(`Export failed · ${msg}`, { id: toastId });
      setGenericError(msg);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-sm">
            <Bookmark className="size-3.5 text-primary" />
            Export collection
          </DialogTitle>
          <DialogDescription className="truncate">{collection.name}</DialogDescription>
        </DialogHeader>

        {conflict ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs">A file already exists at:</p>
            <p className="break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-2xs">{conflict.existing_path}</p>
            <p className="text-2xs text-muted-foreground">
              Existing size: {Math.max(1, Math.round(conflict.existing_size_bytes / 1024)).toLocaleString()} KB.
              Overwrite?
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel>Format</FieldLabel>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="format"
                    value="parquet"
                    checked={format === "parquet"}
                    onChange={() => setFormat("parquet")}
                  />
                  Parquet
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="format"
                    value="csv"
                    checked={format === "csv"}
                    onChange={() => setFormat("csv")}
                  />
                  CSV
                </label>
              </div>
            </Field>

            <Field>
              <FieldLabel>Save to</FieldLabel>
              <Input
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="/Users/you/exports"
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
              />
              {recentDirs.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className="text-3xs text-muted-foreground">Recent:</span>
                  {recentDirs.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setOutputDir(d)}
                      className="rounded-md border border-dashed border-border bg-muted/40 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={d}
                    >
                      {d.length > 28 ? `…${d.slice(-26)}` : d}
                    </button>
                  ))}
                </div>
              )}
            </Field>

            <Field>
              <FieldLabel>Filename</FieldLabel>
              <div className="flex items-center gap-1">
                <Input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="my-collection"
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                />
                <span className="select-none font-mono text-2xs text-muted-foreground">.{ext}</span>
              </div>
            </Field>

            <div className="rounded-md border border-border-subtle bg-muted/20 px-2 py-1.5">
              <div className="text-3xs text-muted-foreground">Path preview</div>
              <div className="break-all font-mono text-2xs">{previewPath}</div>
            </div>

            {genericError && <p className="text-2xs text-destructive">{genericError}</p>}
          </div>
        )}

        <DialogFooter>
          {conflict ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConflict(null)}>
                Back
              </Button>
              <Button type="button" variant="destructive" size="sm" onClick={() => void submit(true)}>
                Overwrite
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={!canSubmit} onClick={() => void submit(false)}>
                <Download />
                {submitting ? "Exporting…" : "Export"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
