/**
 * The table toolbar: search, the `Filter │ Sort │ Group │ Fields` group,
 * the selection, Save / Discard while edits are unsaved, the field menu
 * ("Write fields to file…") and the obs count. Every pop-up uses the
 * standard frame.
 */

import { ArrowDownIcon, ArrowUpIcon, CheckIcon, EllipsisIcon, GripVerticalIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { CommitAnnotationsResponse } from "@ndea/protocol";
import { Button } from "@ndea/ui/components/button";
import { ButtonGroup } from "@ndea/ui/components/button-group";
import { Combobox } from "@ndea/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ndea/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ndea/ui/components/dropdown-menu";
import { IconButton, iconButtonVariants } from "@ndea/ui/components/icon-button";
import { Input } from "@ndea/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  popoverHeading,
  popoverRow,
  popoverSeparator,
} from "@ndea/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { cn } from "@ndea/ui/lib/utils";
import { type Condition, CONDITION_OPS, FIELD_GLYPH, isGroupable, type SortState, type TableField } from "./fields";

const obs = (n: number) => `${n.toLocaleString("en-US")} obs`;
const menuRow = cn(popoverRow, "w-full text-left hover:bg-muted");

function Tool({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-[22px] items-center whitespace-nowrap px-2.5 text-ui-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring data-popup-open:bg-muted",
          active ? "bg-accent text-accent-foreground" : "text-text-muted",
        )}
      >
        {label}
      </PopoverTrigger>
      {children}
    </Popover>
  );
}

// ── Filter builder ──────────────────────────────────────────────────

function ConditionRow({
  condition,
  first,
  fields,
  values,
  onChange,
  onRemove,
}: {
  condition: Condition;
  first: boolean;
  fields: readonly TableField[];
  values: (field: string) => Promise<string[]>;
  onChange(next: Condition): void;
  onRemove(): void;
}) {
  const field = fields.find((f) => f.name === condition.column);
  const type = field?.type ?? "text";
  const ops = CONDITION_OPS[type];
  const [options, setOptions] = useState<{ column: string; values: string[] } | null>(null);
  const needsValue = condition.op !== "isNull" && condition.op !== "isNotNull";
  const choice = type === "category" || type === "label";
  useEffect(() => {
    if (!choice) return;
    let live = true;
    values(condition.column).then(
      (v) => live && setOptions({ column: condition.column, values: v }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [choice, condition.column, values]);
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1.5 border-muted border-t px-1 py-1.5">
      <span className="text-sm text-text-muted">{first ? "where" : "and"}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Select
          items={fields.map((f) => ({ value: f.name, label: f.name }))}
          value={condition.column}
          onValueChange={(column) =>
            column &&
            onChange({
              column,
              op: CONDITION_OPS[fields.find((f) => f.name === column)?.type ?? "text"][0].op,
              value: "",
            })
          }
        >
          <SelectTrigger size="sm" aria-label="Field" className="max-w-40 font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.name} value={f.name} className="font-mono">
                {f.name}
                <span className="ml-auto font-sans text-2xs text-text-muted">{FIELD_GLYPH[f.type]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={ops.map((o) => ({ value: o.op, label: o.label }))}
          value={condition.op}
          onValueChange={(op) => op && onChange({ ...condition, op })}
        >
          <SelectTrigger size="sm" aria-label="Operator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ops.map((o) => (
              <SelectItem key={o.op} value={o.op}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!needsValue ? null : type === "boolean" ? (
          <Select
            items={[
              { value: "true", label: "true" },
              { value: "false", label: "false" },
            ]}
            value={condition.value || null}
            onValueChange={(value) => onChange({ ...condition, value: value ?? "" })}
          >
            <SelectTrigger size="sm" aria-label="Value">
              <SelectValue placeholder="value" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        ) : choice ? (
          <Combobox
            value={condition.value}
            onValueChange={(value) => onChange({ ...condition, value })}
            options={(options?.values ?? []).map((v) => ({ value: v, label: v }))}
            placeholder="value"
            searchPlaceholder="Find a value"
            triggerClassName="h-[22px] max-w-40 font-mono"
          />
        ) : (
          <Input
            aria-label="Value"
            inputMode={type === "number" ? "decimal" : undefined}
            placeholder="value"
            value={condition.value}
            onChange={(e) => onChange({ ...condition, value: e.currentTarget.value })}
            className="h-[22px] w-24 font-mono"
          />
        )}
      </div>
      <IconButton label="Remove condition" onClick={onRemove}>
        <XIcon />
      </IconButton>
    </div>
  );
}

function FilterBuilder({
  fields,
  conditions,
  count,
  values,
  onChange,
}: {
  fields: readonly TableField[];
  conditions: readonly Condition[];
  count: number | null;
  values: (field: string) => Promise<string[]>;
  onChange(next: Condition[]): void;
}) {
  const add = () => {
    const field = fields[0];
    if (field) onChange([...conditions, { column: field.name, op: CONDITION_OPS[field.type][0].op, value: "" }]);
  };
  return (
    <PopoverContent align="start" className="w-[440px] max-w-[calc(100vw-16px)] gap-0">
      <div className="flex items-baseline gap-2 px-1.5 pt-1 pb-1.5">
        <span className="font-semibold">Filter</span>
        <span className="text-sm text-text-muted">narrows this table and every view in its filter link</span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {conditions.length === 0 ? <div className="px-1.5 py-2 text-text-muted">No conditions yet.</div> : null}
        {conditions.map((condition, i) => (
          <ConditionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no identity beyond their slot
            key={i}
            condition={condition}
            first={i === 0}
            fields={fields}
            values={values}
            onChange={(next) => onChange(conditions.map((c, j) => (j === i ? next : c)))}
            onRemove={() => onChange(conditions.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 border-border border-t-(length:--keyline) px-0.5 pt-1.5">
        <Button variant="ghost" size="sm" className="text-primary" onClick={add}>
          + Add condition
        </Button>
        <span className="flex-1 text-right font-mono text-sm text-text-muted">{count === null ? "" : obs(count)}</span>
        {conditions.length ? (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        ) : null}
      </div>
    </PopoverContent>
  );
}

// ── Sort, group, fields ─────────────────────────────────────────────

function SortMenu({
  fields,
  sort,
  onSort,
}: {
  fields: readonly TableField[];
  sort: SortState | null;
  onSort(next: SortState | null): void;
}) {
  return (
    <PopoverContent align="start" className="w-64 gap-0">
      <div className={popoverHeading}>Sort rows</div>
      <div className="max-h-72 overflow-y-auto">
        {fields.map((f) => (
          <div key={f.name} className={cn(popoverRow, "py-1 hover:bg-transparent")}>
            <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
            {(["asc", "desc"] as const).map((dir) => {
              const on = sort?.col === f.name && sort.dir === dir;
              return (
                <IconButton
                  key={dir}
                  label={`${f.name} ${dir === "asc" ? (f.type === "number" ? "1→9" : "A→Z") : f.type === "number" ? "9→1" : "Z→A"}`}
                  pressed={on}
                  onClick={() => onSort(on ? null : { col: f.name, dir })}
                >
                  {dir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
                </IconButton>
              );
            })}
          </div>
        ))}
      </div>
      {sort ? (
        <>
          <div className={popoverSeparator} />
          <button type="button" className={cn(menuRow, "text-text-muted")} onClick={() => onSort(null)}>
            Clear sort
          </button>
        </>
      ) : null}
    </PopoverContent>
  );
}

function GroupMenu({
  fields,
  groupBy,
  onGroup,
}: {
  fields: readonly TableField[];
  groupBy: string | null;
  onGroup(field: string | null): void;
}) {
  const choices = [null, ...fields.filter((f) => isGroupable(f.type)).map((f) => f.name)];
  return (
    <PopoverContent align="start" className="w-56 gap-0">
      <div className={popoverHeading}>Group rows by</div>
      <div className="max-h-72 overflow-y-auto">
        {choices.map((name) => (
          <button key={name ?? ""} type="button" className={menuRow} onClick={() => onGroup(name)}>
            <CheckIcon className={cn("size-3 text-primary", groupBy !== name && "opacity-0")} />
            <span className={cn("truncate", name ? "font-mono" : "text-text-muted")}>{name ?? "None"}</span>
          </button>
        ))}
      </div>
    </PopoverContent>
  );
}

function FieldsMenu({
  fields,
  visible,
  onChange,
}: {
  fields: readonly TableField[];
  visible: readonly string[];
  onChange(next: string[] | null): void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  // Shown fields first, in their order, then the hidden ones.
  const order = [...visible, ...fields.map((f) => f.name).filter((n) => !visible.includes(n))];
  const byName = new Map(fields.map((f) => [f.name, f]));
  return (
    <PopoverContent align="start" className="w-64 gap-0">
      <div className={popoverHeading}>
        Fields · {visible.length} of {fields.length} shown
      </div>
      <div className="max-h-80 overflow-y-auto">
        {order.map((name) => {
          const on = visible.includes(name);
          return (
            <button
              key={name}
              type="button"
              draggable={on}
              onDragStart={() => setDragged(name)}
              onDragOver={(e) => on && dragged && e.preventDefault()}
              onDrop={() => {
                if (!dragged || dragged === name) return;
                const next = visible.filter((n) => n !== dragged);
                next.splice(next.indexOf(name), 0, dragged);
                onChange(next);
                setDragged(null);
              }}
              className={menuRow}
              onClick={() => {
                const next = on ? visible.filter((n) => n !== name) : [...visible, name];
                if (next.length) onChange(next);
              }}
            >
              <CheckIcon className={cn("size-3 text-primary", !on && "opacity-0")} />
              <span className={cn("min-w-0 flex-1 truncate font-mono", !on && "text-text-muted")}>{name}</span>
              <span className="font-sans font-semibold text-[9.5px] text-text-muted">
                {FIELD_GLYPH[byName.get(name)?.type ?? "text"]}
              </span>
              <GripVerticalIcon className={cn("size-3 text-text-muted", !on && "invisible")} />
            </button>
          );
        })}
      </div>
      <div className={popoverSeparator} />
      <button type="button" className={cn(menuRow, "text-text-muted")} onClick={() => onChange(null)}>
        Show all
      </button>
    </PopoverContent>
  );
}

// ── Write fields to file ────────────────────────────────────────────

/** Dry run first; the real write only after Confirm. */
export function CommitDialog({
  report,
  writing,
  onConfirm,
  onClose,
}: {
  report: CommitAnnotationsResponse | null;
  writing: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const writable = report?.datasets.filter((d) => !("error" in d)) ?? [];
  return (
    <Dialog open={report !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Write fields to file</DialogTitle>
          <DialogDescription>
            Writes every annotation field into the AnnData obs on disk. Obs without a value become NA. This can't be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          {report?.datasets.map((d) => (
            <div key={d.datasetKey || d.path} className="rounded-md bg-muted px-2.5 py-2">
              <div className="truncate font-mono text-sm" title={d.path}>
                {d.path ?? d.datasetKey}
              </div>
              {"error" in d ? (
                <div className="text-sm text-destructive">{d.error}</div>
              ) : (
                <>
                  <div className="text-sm text-text-muted">
                    zarr {d.format} · {obs(d.nObs)}
                  </div>
                  {d.columns.map((c) => (
                    <div key={c.name} className="flex gap-2 font-mono text-sm">
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-text-muted">{c.kind}</span>
                      <span>{c.nNonNull.toLocaleString("en-US")} with a value</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={writing || writable.length === 0} onClick={onConfirm}>
            {writing ? "Writing…" : `Write to ${writable.length} file${writable.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Toolbar ─────────────────────────────────────────────────────────

export interface ToolbarProps {
  fields: readonly TableField[];
  visible: readonly string[];
  search: string;
  onSearch(text: string): void;
  conditions: readonly Condition[];
  onConditions(next: Condition[]): void;
  sort: SortState | null;
  onSort(next: SortState | null): void;
  groupBy: string | null;
  onGroup(field: string | null): void;
  onColumns(next: string[] | null): void;
  values: (field: string) => Promise<string[]>;
  count: number | null;
  selected: number;
  onClearSelection(): void;
  edits: number;
  saving: boolean;
  onSave(): void;
  onDiscard(): void;
  canWrite: boolean;
  onWrite(): void;
}

export function Toolbar(props: ToolbarProps) {
  const { fields, sort, groupBy, conditions, count, selected, edits } = props;
  const hidden = fields.length - props.visible.length;
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 overflow-hidden px-1.5">
      <Input
        aria-label="Search"
        placeholder="Search"
        value={props.search}
        onChange={(e) => props.onSearch(e.currentTarget.value)}
        className="h-[22px] w-28 min-w-12 shrink"
      />
      <ButtonGroup className="shrink-0 border-line-2 [&>*+*]:border-line-2">
        <Tool label={conditions.length ? `Filter · ${conditions.length}` : "Filter"} active={conditions.length > 0}>
          <FilterBuilder
            fields={fields}
            conditions={conditions}
            count={count}
            values={props.values}
            onChange={props.onConditions}
          />
        </Tool>
        <Tool label={sort ? `Sort: ${sort.col} ${sort.dir === "asc" ? "↑" : "↓"}` : "Sort"} active={sort !== null}>
          <SortMenu fields={fields} sort={sort} onSort={props.onSort} />
        </Tool>
        <Tool label={groupBy ? `Group: ${groupBy}` : "Group"} active={groupBy !== null}>
          <GroupMenu fields={fields} groupBy={groupBy} onGroup={props.onGroup} />
        </Tool>
        <Tool label={hidden > 0 ? `${hidden} hidden` : "Fields"} active={hidden > 0}>
          <FieldsMenu fields={fields} visible={props.visible} onChange={props.onColumns} />
        </Tool>
      </ButtonGroup>
      {selected > 0 ? (
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap pl-1">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="font-mono text-sm">{obs(selected)}</span>
          <span className="text-sm text-text-muted">selected</span>
          <Button variant="ghost" size="sm" className="text-primary" onClick={props.onClearSelection}>
            Clear
          </Button>
        </span>
      ) : null}
      <span className="flex-1" />
      {edits > 0 ? (
        <>
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-dirty text-sm">
            <span className="size-1.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--dirty)]" />
            {edits.toLocaleString("en-US")} {edits === 1 ? "edit" : "edits"} unsaved
          </span>
          <Button variant="ghost" size="sm" disabled={props.saving} onClick={props.onDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={props.saving} onClick={props.onSave}>
            {props.saving ? "Saving…" : "Save"}
          </Button>
        </>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="More" title="More" className={iconButtonVariants()}>
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled={!props.canWrite} onClick={props.onWrite}>
            Write fields to file…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="shrink-0 whitespace-nowrap font-mono text-sm text-text-muted">
        {count === null ? "" : obs(count)}
      </span>
    </div>
  );
}
