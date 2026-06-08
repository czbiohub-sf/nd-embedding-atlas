/**
 * SaveCollectionForm — inline form for creating a new collection from
 * the active scatter selection. Lives inside the unified CollectionsSheet
 * (no Sheet wrapper of its own) — the bookmark trigger expands this in
 * the same panel as the saved-collections list.
 *
 * "Add to existing" lives as a per-row action on CollectionRow, not as a
 * tab here — context-sensitive surface, not a duplicated form mode.
 */

import { Bookmark, Plus, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldHint, FieldLabel, FieldPrimitive } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup, KbdMod } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { CollectionNameSchema } from "../../../protocol/index.ts";
import { useCreateCollection } from "./useCollections";

const PRESET_COLORS = [
  "#a78bfa", // violet
  "#60a5fa", // blue
  "#22d3ee", // cyan
  "#34d399", // emerald
  "#facc15", // amber
  "#fb923c", // orange
  "#f472b6", // pink
];

function defaultName(count: number): string {
  const d = new Date();
  const md = d.toLocaleString(undefined, { month: "short", day: "numeric" });
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `Selection · ${md} ${hm} · ${count.toLocaleString()} obs`;
}

interface Props {
  /** Reads the live row indices at submit time; never stale. */
  getRowIndices: () => readonly number[];
  /** Snapshotted at form mount to avoid jitter while user keeps brushing. */
  selectionCount: number;
  /** Called after a successful save so the parent can collapse the section. */
  onSaved: () => void;
  /** Called when the user clicks Cancel. */
  onCancel: () => void;
}

export function SaveCollectionForm({ getRowIndices, selectionCount, onSaved, onCancel }: Props) {
  const [name, setName] = useState(() => defaultName(selectionCount));
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const createCollection = useCreateCollection();

  // Snapshot row indices on mount so the count and submit payload stay
  // consistent if the user keeps brushing while the form is open.
  const indicesRef = useRef<readonly number[]>([]);
  useEffect(() => {
    indicesRef.current = getRowIndices();
  }, [getRowIndices]);

  const clientNameError = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return null;
    const result = CollectionNameSchema.safeParse(trimmed);
    if (result.success) return null;
    return result.error.issues[0]?.message ?? "Invalid name";
  }, [name]);

  const isPending = createCollection.isPending;
  const canSubmit = selectionCount > 0 && !isPending && name.trim().length > 0 && clientNameError === null;

  async function handleSubmit(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!canSubmit) return;
    setServerError(null);

    // Two-step: stage indices in __scatter_selection (battle-tested), then
    // hit the create endpoint with a tiny body.
    try {
      await fetch("/api/scatter-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_indices: Array.from(indicesRef.current) }),
      });
    } catch (err) {
      console.error("[collections] scatter-selection upload failed", err);
    }

    createCollection.mutate(
      {
        name: name.trim(),
        color,
        notes: notes.trim() || null,
        tags,
        from_scatter_selection: true,
      },
      {
        onSuccess: () => onSaved(),
        onError: (err) => setServerError(err instanceof Error ? err.message : "Save failed"),
      },
    );
  }

  function commitTag() {
    const t = tagInput.trim().replace(/[\s -]+/g, "-");
    if (t && !tags.includes(t) && tags.length < 32) {
      setTags([...tags, t]);
    }
    setTagInput("");
  }

  function handleTagKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={(e) => {
        // Cmd/Ctrl+Enter triggers submit from any focused field.
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void handleSubmit(e);
        }
      }}
      className="flex flex-col gap-4 px-4 py-3"
      autoComplete="off"
      data-1p-ignore
      data-form-type="other"
    >
      <Field>
        <FieldLabel>
          Name <FieldHint>required</FieldHint>
        </FieldLabel>
        <FieldPrimitive.Control
          render={
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (serverError) setServerError(null);
              }}
              placeholder="e.g. Apoptotic clusters"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              required
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
          }
        />
        <FieldError clientError={clientNameError} serverError={serverError} />
      </Field>

      <Field>
        <FieldLabel>Color</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="size-6 rounded-md border border-white/10 transition-all hover:scale-110"
              style={{
                background: c,
                outline: color === c ? "2px solid var(--foreground)" : "none",
                outlineOffset: 2,
              }}
              aria-label={`Color ${c}`}
            />
          ))}
          <label className="ml-1 inline-flex size-6 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-muted/40 text-muted-foreground hover:bg-muted">
            <input
              type="color"
              value={color.startsWith("#") ? color : "#a78bfa"}
              onChange={(e) => setColor(e.target.value)}
              className="absolute size-0 opacity-0"
            />
            <Plus className="size-3" />
          </label>
        </div>
      </Field>

      <Field>
        <FieldLabel>
          Tags <FieldHint>optional</FieldHint>
        </FieldLabel>
        <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border border-input bg-input/20 px-1.5 py-1 dark:bg-input/30">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              <span>{t}</span>
              <button
                type="button"
                onClick={() => setTags(tags.filter((x) => x !== t))}
                className="rounded text-muted-foreground hover:text-foreground"
                aria-label={`Remove tag ${t}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKey}
            onBlur={commitTag}
            placeholder={tags.length === 0 ? "Add a tag, press Enter…" : ""}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            className="min-w-[80px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </Field>

      <Field>
        <FieldLabel>
          Notes <FieldHint>optional</FieldHint>
        </FieldLabel>
        <FieldPrimitive.Control
          render={
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this set capture? Why is it interesting?"
              rows={2}
              maxLength={4096}
            />
          }
        />
      </Field>

      <p className="text-2xs text-muted-foreground">
        Adds {selectionCount.toLocaleString()} obs · server dedupes by member key.
      </p>

      <div className="flex flex-row items-center gap-2 border-border border-t pt-3">
        <span className="mr-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <KbdGroup>
            <KbdMod />
            <Kbd>↵</Kbd>
          </KbdGroup>
          to save
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          <Bookmark />
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
