/**
 * SaveObsSetDialog — modal to name and save the current lasso selection as an ObsSet.
 *
 * On open: resolves row indices → (dataset_key, obs_name) pairs via DuckDB.
 * On submit: calls POST /api/obssets via useCreateObsSet().
 */

import { useEffect, useRef, useState } from "react";
import { useDashboard } from "../../hooks/useDashboard";
import { toRows } from "../../lib/mosaic-helpers";
import { useCreateObsSet } from "./useObsSets";

interface SaveObsSetDialogProps {
  open: boolean;
  onClose: () => void;
  /** "inline" = small selection (<5000), use WHERE __row_index__ IN (...);
   *  "temp_table" = large selection, join against __scatter_selection */
  selectionPath: "inline" | "temp_table";
  /** Callback — reads rowIndicesRef.current at call time, never stale */
  getRowIndices: () => readonly number[];
}

interface Member {
  dataset_key: string;
  obs_name: string;
}

export function SaveObsSetDialog({ open, onClose, getRowIndices }: SaveObsSetDialogProps) {
  const { meta } = useDashboard();
  const { coordinator } = meta;

  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const createObsSet = useCreateObsSet();
  const nameRef = useRef<HTMLInputElement>(null);

  // Resolve members when dialog opens
  useEffect(() => {
    if (!open) {
      setMembers(null);
      setResolveError(null);
      setName("");
      return;
    }

    setResolving(true);
    setResolveError(null);
    setMembers(null);

    const indices = getRowIndices();

    if (indices.length === 0) {
      setMembers([]);
      setResolving(false);
      return;
    }
    const inList = indices.join(", ");
    const sql = `
        SELECT _dataset AS dataset_key, obs_name
        FROM obs_base
        WHERE __row_index__ IN (${inList})
      `;

    coordinator
      .query(sql, { type: "json" })
      .then((result: unknown) => {
        const rows = toRows<Member>(result);
        setMembers(rows);
        setResolving(false);
        // Focus name input once resolved
        setTimeout(() => nameRef.current?.focus(), 0);
      })
      .catch((err: unknown) => {
        setResolveError(err instanceof Error ? err.message : String(err));
        setResolving(false);
      });
    // coordinator is a stable singleton — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, coordinator, getRowIndices]);

  if (!open) return null;

  const canSubmit = name.trim().length > 0 && members != null && !resolving && !createObsSet.isPending;

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || !members) return;
    createObsSet.mutate({ name: name.trim(), color: color || null, members }, { onSuccess: () => onClose() });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-80 flex-col gap-4 rounded-xl border border-border-subtle bg-surface-primary p-5 shadow-xl">
        <h2 className="font-semibold text-sm text-text-primary">Save selection as ObsSet</h2>

        {resolving && <p className="text-text-secondary text-xs">Resolving members…</p>}
        {resolveError && <p className="text-red-400 text-xs">Error: {resolveError}</p>}
        {members != null && !resolving && <p className="text-text-secondary text-xs">{members.length} observations</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-text-secondary text-xs" htmlFor="obsset-name">
              Name
            </label>
            <input
              ref={nameRef}
              id="obsset-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cluster A"
              className="rounded-md border border-border-subtle bg-surface-secondary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-text-secondary text-xs" htmlFor="obsset-color">
              Color
            </label>
            <input
              id="obsset-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-full cursor-pointer rounded-md border border-border-subtle bg-surface-secondary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-text-secondary text-xs hover:bg-surface-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-md bg-primary px-3 py-1.5 text-white text-xs disabled:opacity-40"
            >
              {createObsSet.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
