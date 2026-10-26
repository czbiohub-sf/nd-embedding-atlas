/**
 * The table grid (design data/DataTable.jsx): sticky header with type glyphs,
 * provenance markers and column menus, a trailing + that adds a field, and
 * virtualized rows (or group headers) over the server-side pages. Label and
 * text field cells edit inline; edited cells carry a 2px amber bar until saved.
 */

import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AnnotationDtype } from "@ndea/protocol";
import { Checkbox } from "@ndea/ui/components/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ndea/ui/components/command";
import { Input } from "@ndea/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverHeading,
  popoverRow,
  popoverSeparator,
} from "@ndea/ui/components/popover";
import { cn } from "@ndea/ui/lib/utils";
import { useVirtualizer } from "../query/use-virtualizer";
import {
  FIELD_GLYPH,
  type GroupLayout,
  groupKey,
  hasBit,
  isGroupable,
  type SortState,
  type TableField,
} from "./fields";
import type { Row, TableQuery } from "./useTableQuery";

const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 28;
const LEAD_WIDTH = 56;

/** Unsaved cell values: field → row index → value (null clears). */
export type Edits = ReadonlyMap<string, ReadonlyMap<number, string | null>>;

export type Provenance = "obs" | "saved" | "unsaved";

/** What the grid asks of the view: every write goes through here. */
export interface TableActions {
  sort(next: SortState | null): void;
  group(field: string | null): void;
  hide(field: string): void;
  addField(name: string, dtype: AnnotationDtype): void;
  renameField(from: string, to: string): void;
  convertField(name: string, dtype: AnnotationDtype): void;
  deleteField(name: string): void;
  /** Distinct saved values of a field, for the label editor and the filter builder. */
  values(field: string): Promise<string[]>;
  edit(field: string, rowIndex: number, value: string | null, saved: string | null): void;
  clickRow(position: number, rowIndex: number, event: React.MouseEvent): void;
  toggleRow(rowIndex: number): void;
  toggleAll(): void;
  toggleGroup(key: string): void;
}

export interface DataTableProps {
  fields: readonly TableField[];
  query: TableQuery;
  /** Grouped rows; null lists rows flat. */
  layout: GroupLayout | null;
  sort: SortState | null;
  groupBy: string | null;
  focused: number | null;
  /** A request to bring a virtual index into view (the focused row); each request object is applied once. */
  reveal: { readonly index: number } | null;
  selection: Uint32Array | null;
  /** Selected obs count, for the header checkbox. */
  selected: number;
  edits: Edits;
  provenance: ((field: TableField) => Provenance) | null;
  actions: TableActions;
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (typeof value === "bigint") return value.toLocaleString("en-US");
  if (value instanceof Date) return value.toISOString();
  return typeof value === "object" ? JSON.stringify(value) : String(value as string | boolean);
}

/** Column width from the header and the first loaded rows. */
function columnWidth(field: TableField, rows: Row[]): number {
  let chars = field.name.length + 6;
  for (const row of rows)
    chars = Math.max(chars, formatValue(row[field.name]).length + (field.type === "label" ? 3 : 0));
  return Math.min(320, Math.max(field.type === "number" ? 72 : 96, chars * 6.6 + 24));
}

function Pill({ children, empty }: { children: ReactNode; empty?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2 py-px font-sans text-sm",
        empty ? "text-text-muted shadow-[inset_0_0_0_1px_var(--line-2)]" : "bg-muted text-foreground",
      )}
    >
      {children}
    </span>
  );
}

function ProvenanceDot({ status }: { status: Provenance }) {
  if (status === "obs") return null;
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        status === "saved" ? "bg-text-muted" : "shadow-[inset_0_0_0_1.5px_var(--dirty)]",
      )}
    />
  );
}

const menuRow = cn(popoverRow, "w-full text-left hover:bg-muted");

function ColumnMenu({
  field,
  sort,
  groupBy,
  actions,
  status,
}: {
  field: TableField;
  sort: SortState | null;
  groupBy: string | null;
  actions: TableActions;
  status: Provenance;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(field.name);
  const close = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  const sorted = sort?.col === field.name ? sort.dir : null;
  const align = field.type === "number" ? "justify-end" : "justify-start";
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(field.name);
      }}
    >
      <PopoverTrigger
        title={`${field.name} · ${field.annotation ? `${field.type} field` : `${field.type} · from obs in the file, read-only`}`}
        className={cn(
          "flex h-full w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-text-muted outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-popup-open:bg-muted data-popup-open:text-foreground",
          align,
        )}
      >
        <span className="shrink-0 font-sans font-semibold text-[9.5px]">{FIELD_GLYPH[field.type]}</span>
        <span className="min-w-0 truncate">{field.name}</span>
        <ProvenanceDot status={status} />
        {sorted ? <span className="shrink-0 text-primary">{sorted === "asc" ? "↑" : "↓"}</span> : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0">
        <div className={popoverHeading}>
          {field.annotation ? `Edit field · ${field.type}` : `${field.name} · ${field.type}`}
        </div>
        {field.annotation ? (
          <Input
            aria-label="Field name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const next = name.trim();
              setOpen(false);
              if (next && next !== field.name) actions.renameField(field.name, next);
            }}
            className="mx-1 mb-1 w-auto font-mono"
          />
        ) : null}
        {(["asc", "desc"] as const).map((dir) => (
          <button
            key={dir}
            type="button"
            className={cn(menuRow, sorted === dir && "bg-muted")}
            onClick={close(() => actions.sort(sorted === dir ? null : { col: field.name, dir }))}
          >
            {dir === "asc" ? "Sort ascending" : "Sort descending"}
          </button>
        ))}
        {isGroupable(field.type) ? (
          <button
            type="button"
            className={cn(menuRow, groupBy === field.name && "bg-muted")}
            onClick={close(() => actions.group(groupBy === field.name ? null : field.name))}
          >
            {groupBy === field.name ? "Ungroup" : "Group by this field"}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(menuRow, "text-text-muted")}
          onClick={close(() => actions.hide(field.name))}
        >
          Hide field
        </button>
        {field.annotation ? (
          <>
            <div className={popoverSeparator} />
            <button
              type="button"
              className={menuRow}
              onClick={close(() => actions.convertField(field.name, field.annotation === "label" ? "text" : "label"))}
            >
              {field.annotation === "label" ? "Convert to text" : "Convert to label"}
              <span className="ml-auto text-sm text-text-muted">
                {field.annotation === "label" ? "free text" : "values become labels"}
              </span>
            </button>
            <div className={popoverSeparator} />
            <button
              type="button"
              className={cn(menuRow, "text-destructive")}
              onClick={close(() => actions.deleteField(field.name))}
            >
              Delete field…
            </button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function AddField({ actions }: { actions: TableActions }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = (dtype: AnnotationDtype) => {
    const next = name.trim();
    if (!next) return;
    setOpen(false);
    setName("");
    actions.addField(next, dtype);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Add a field"
        title="Add a field"
        className="flex size-5 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-muted hover:text-foreground data-popup-open:bg-muted"
      >
        <PlusIcon className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-0">
        <div className={popoverHeading}>New field</div>
        <Input
          aria-label="Field name"
          placeholder="Field name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && add("label")}
          className="mx-1 mb-1 w-auto font-mono"
        />
        <button type="button" className={menuRow} disabled={!name.trim()} onClick={() => add("label")}>
          <span className="w-4 font-sans font-semibold text-[9.5px] text-text-muted">{FIELD_GLYPH.label}</span>
          Label
          <span className="ml-auto text-sm text-text-muted">pick or type a label</span>
        </button>
        <button type="button" className={menuRow} disabled={!name.trim()} onClick={() => add("text")}>
          <span className="w-4 font-sans font-semibold text-[9.5px] text-text-muted">{FIELD_GLYPH.text}</span>
          Text
          <span className="ml-auto text-sm text-text-muted">free text</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

/** Label cell: pick an existing label or type a new one. */
function LabelEditor({
  field,
  value,
  onPick,
  values,
}: {
  field: string;
  value: string | null;
  onPick(value: string | null): void;
  values: TableActions["values"];
}) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const term = typed.trim();
  const pick = (next: string | null) => {
    setOpen(false);
    onPick(next);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setTyped("");
        void values(field).then(setLabels, () => setLabels([]));
      }}
    >
      <PopoverTrigger
        className="flex h-full w-full min-w-0 items-center outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {value ? <Pill>{value}</Pill> : <Pill empty>add</Pill>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-0 p-1.5" onClick={(e) => e.stopPropagation()}>
        <Command>
          <CommandInput placeholder="Find or create a label" value={typed} onValueChange={setTyped} />
          <CommandList className="max-h-56">
            <CommandEmpty>Type a label to create it.</CommandEmpty>
            <CommandGroup>
              {labels.map((label) => (
                <CommandItem key={label} value={label} data-checked={label === value} onSelect={() => pick(label)}>
                  {label}
                </CommandItem>
              ))}
              {term && !labels.includes(term) ? (
                <CommandItem value={`\u0000create ${term}`} onSelect={() => pick(term)} className="text-primary">
                  Create “{term}”
                </CommandItem>
              ) : null}
              {value ? (
                <CommandItem value={"\u0000clear"} onSelect={() => pick(null)} className="text-text-muted">
                  Clear
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Text cell: click to type; Enter or leaving the cell keeps the text, Escape drops it. */
function TextEditor({ value, onCommit }: { value: string | null; onCommit(value: string | null): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button
        type="button"
        className="flex h-full w-full min-w-0 items-center text-left outline-none"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value ?? "");
        }}
      >
        {value ? <span className="truncate">{value}</span> : <span className="font-sans text-text-muted">add</span>}
      </button>
    );
  }
  const commit = () => {
    setDraft(null);
    onCommit(draft === "" ? null : draft);
  };
  return (
    <Input
      autoFocus
      aria-label="Cell value"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      className="h-5 rounded-xs px-1 font-mono text-sm"
    />
  );
}

function Cell({ field, row, edits, actions }: { field: TableField; row: Row; edits: Edits; actions: TableActions }) {
  const rowIndex = Number(row.__row_index__);
  const raw = row[field.name];
  const pending = edits.get(field.name);
  const dirty = pending?.has(rowIndex) ?? false;
  const saved = raw == null ? null : formatValue(raw);
  const value = dirty ? pending!.get(rowIndex)! : saved;
  const edit = (next: string | null) => actions.edit(field.name, rowIndex, next, saved);

  let content: ReactNode;
  if (field.annotation === "label") {
    content = <LabelEditor field={field.name} value={value} onPick={edit} values={actions.values} />;
  } else if (field.annotation === "text") {
    content = <TextEditor value={value} onCommit={edit} />;
  } else if (raw == null) {
    content = null;
  } else if (field.type === "category") {
    content = <Pill>{formatValue(raw)}</Pill>;
  } else if (field.type === "boolean") {
    content = <Checkbox checked={raw === true} readOnly aria-label={field.name} />;
  } else {
    content = <span className="truncate">{formatValue(raw)}</span>;
  }
  return (
    <div
      className={cn(
        "flex h-full min-w-0 items-center border-muted border-l px-2",
        field.type === "number" && "justify-end tabular-nums",
        dirty && "shadow-[inset_2px_0_0_var(--dirty)]",
      )}
      title={field.annotation || raw == null ? undefined : formatValue(raw)}
    >
      {content}
    </div>
  );
}

export function DataTable({
  fields,
  query,
  layout,
  sort,
  groupBy,
  focused,
  reveal,
  selection,
  selected,
  edits,
  provenance,
  actions,
}: DataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = query.count ?? 0;
  const length = layout ? layout.length : count;

  // Widths latch per field set once the first rows arrive (state set while rendering, React's
  // pattern for values derived from earlier renders).
  const fieldKey = fields.map((f) => `${f.name}:${f.type}`).join("\u0000");
  const [widths, setWidths] = useState<{ key: string; px: number[] } | null>(null);
  if (query.getRow(0) && widths?.key !== fieldKey) {
    const sample: Row[] = [];
    for (let i = 0; i < 50; i++) {
      const row = query.getRow(i);
      if (row) sample.push(row);
    }
    setWidths({ key: fieldKey, px: fields.map((f) => columnWidth(f, sample)) });
  }
  const columns = fields.map((f, i) => (widths?.key === fieldKey ? widths.px[i] : columnWidth(f, [])));
  const template = `${LEAD_WIDTH}px ${columns.map((w) => `${w}px`).join(" ")} 32px`;
  const totalWidth = LEAD_WIDTH + columns.reduce((a, b) => a + b, 0) + 32;

  const { virtualItems, totalSize, scrollMargin, scrollToIndex } = useVirtualizer({
    count: length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollMargin: HEADER_HEIGHT,
  });

  const first = virtualItems[0]?.index ?? 0;
  const last = virtualItems.at(-1)?.index ?? 0;
  const { ensureRange } = query;
  useEffect(() => {
    if (!layout) return ensureRange(first, last);
    // Load the rows under the visible group headers.
    let lo = Number.POSITIVE_INFINITY;
    let hi = -1;
    for (let i = first; i <= last && i < length; i++) {
      const item = layout.item(i);
      if (item.kind === "row") {
        lo = Math.min(lo, item.position);
        hi = item.position;
      }
    }
    if (hi >= 0) ensureRange(lo, hi);
  }, [first, last, length, layout, ensureRange]);

  // Once per request: re-applying it on a later count change would jump to a row that has moved since. Gated on
  // the rendered height, not `length`: a new count renders once with the old height, and a scroll into rows the
  // DOM lacks is lost while the virtualizer still draws them.
  const revealed = useRef<object | null>(null);
  useEffect(() => {
    if (!reveal || reveal === revealed.current || reveal.index >= totalSize / ROW_HEIGHT) return;
    revealed.current = reveal;
    scrollToIndex(reveal.index, { align: "auto" });
  }, [reveal, totalSize, scrollToIndex]);

  const allChecked = selected > 0 && selected >= count;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-1 font-mono text-sm">
      <div
        className="sticky top-0 z-10 grid border-border border-b-(length:--keyline) bg-surface"
        style={{ gridTemplateColumns: template, height: HEADER_HEIGHT, width: totalWidth }}
      >
        <div className="flex items-center px-1.5">
          <Checkbox
            aria-label={allChecked || selected ? "Clear the selection" : "Select every obs in the table"}
            checked={allChecked}
            indeterminate={selected > 0 && !allChecked}
            onCheckedChange={() => actions.toggleAll()}
          />
        </div>
        {fields.map((field) => (
          <div key={field.name} className="min-w-0 border-muted border-l px-0.5 py-0.5">
            <ColumnMenu
              field={field}
              sort={sort}
              groupBy={groupBy}
              actions={actions}
              status={provenance ? provenance(field) : "obs"}
            />
          </div>
        ))}
        <div className="flex items-center justify-center border-muted border-l">
          <AddField actions={actions} />
        </div>
      </div>

      <div style={{ height: totalSize, width: totalWidth, position: "relative" }}>
        {virtualItems.map((virtual) => {
          const item = layout ? layout.item(virtual.index) : ({ kind: "row", position: virtual.index } as const);
          const style = {
            height: ROW_HEIGHT,
            width: totalWidth,
            transform: `translateY(${virtual.start - scrollMargin}px)`,
          };
          if (item.kind === "group") {
            const value = item.group.value;
            const key = groupKey(value);
            return (
              <button
                key={`g:${key}`}
                type="button"
                className="absolute top-0 left-0 flex items-center border-muted border-b text-left font-sans hover:bg-muted"
                style={style}
                onClick={() => actions.toggleGroup(key)}
              >
                {/* Sticky so the value stays in view when the table scrolls sideways. */}
                <span className="sticky left-0 flex w-fit items-center gap-2 px-1.5">
                  {item.collapsed ? (
                    <ChevronRightIcon className="size-3 text-text-muted" />
                  ) : (
                    <ChevronDownIcon className="size-3 text-text-muted" />
                  )}
                  <span className={cn("font-medium", value === null && "text-text-muted")}>
                    {value === null ? "empty" : formatValue(value)}
                  </span>
                  <span className="font-mono text-text-muted text-xs">
                    {item.group.count.toLocaleString("en-US")} obs
                  </span>
                </span>
              </button>
            );
          }
          const row = query.getRow(item.position);
          const rowIndex = row ? Number(row.__row_index__) : null;
          const isSelected = rowIndex !== null && selection !== null && hasBit(selection, rowIndex);
          const isFocused = rowIndex !== null && rowIndex === focused;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a row holds its own buttons and inputs
            <div
              key={virtual.key}
              role="row"
              tabIndex={-1}
              className={cn(
                "absolute top-0 left-0 grid cursor-pointer border-muted border-b transition-colors",
                isSelected || isFocused ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
              style={{ ...style, gridTemplateColumns: template }}
              onClick={(e) => rowIndex !== null && actions.clickRow(item.position, rowIndex, e)}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 px-1.5 text-2xs text-text-muted",
                  isFocused && "shadow-[inset_2px_0_0_var(--primary)]",
                )}
              >
                <Checkbox
                  aria-label="Select this obs"
                  checked={isSelected}
                  disabled={rowIndex === null}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={() => rowIndex !== null && actions.toggleRow(rowIndex)}
                />
                <span className="truncate">{(item.position + 1).toLocaleString("en-US")}</span>
              </div>
              {row
                ? fields.map((field) => (
                    <Cell key={field.name} field={field} row={row} edits={edits} actions={actions} />
                  ))
                : fields.map((field) => (
                    <div key={field.name} className="flex items-center border-muted border-l px-2">
                      <div className="h-2.5 w-2/3 animate-pulse rounded-xs bg-muted" />
                    </div>
                  ))}
              <div className="border-muted border-l" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
