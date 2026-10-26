/**
 * View settings (gear) in the tile header: an anchored popover with the
 * view's title, Display / Data / Links tabs, and a footer (copy reference,
 * fullscreen, duplicate, remove). Display and Data controls are generated
 * from the component's config schema and its fields' `.meta()` (README §4):
 * boolean → switch, enum of 2–3 → segmented, larger enum → select, number →
 * slider (bounded) or input, `control` strings → a select over that catalog.
 * Fields the view already shows (`hidden`) never render. Every write is a
 * named edit through `ws.apply`, the ops agents use.
 */

import type { JsonValue } from "@ndea/sdk";
import { IconButton, iconButtonVariants } from "@ndea/ui/components/icon-button";
import { HoverTip } from "@ndea/ui/components/hover-tip";
import { Input } from "@ndea/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@ndea/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Slider } from "@ndea/ui/components/slider";
import { Switch } from "@ndea/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ndea/ui/components/tabs";
import { ToggleGroup, ToggleGroupItem } from "@ndea/ui/components/toggle-group";
import { cn } from "@ndea/ui/lib/utils";
import { CopyIcon, Link, Maximize2, Settings, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { z } from "zod";

import type { CoordinationTypeId } from "@/core/coordination/types";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { configFields, type ConfigField } from "./config-fields";
import { allElements, COMPONENTS, componentProps, elementData, elementScope, type DashboardElement } from "./dashboard";
import { LINK_DOT, LINK_LABEL } from "./LinksPopover";
import { copyReference } from "./reference";
import type { WorkspaceDocument } from "./types";
import { applyOrToast, useWorkspace, useWorkspaceSelector } from "./workspace-context";

/** The scope other views share for `type`: the most common one, else the first in state, else "A". */
function sharedScope(document: WorkspaceDocument, type: CoordinationTypeId, id: string): string {
  const counts = new Map<string, number>();
  for (const [other, element] of allElements(document)) {
    const scope = other === id ? undefined : elementScope(element, type);
    if (scope !== undefined) counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  const [top] = [...counts].toSorted((a, b) => b[1] - a[1]);
  return top?.[0] ?? Object.keys(document.state[type] ?? {})[0] ?? "A";
}

/* ── rows and controls ─────────────────────────────────────────────── */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[30px] items-center gap-2.5 border-border not-first:border-t-(length:--keyline)">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}

interface Option {
  readonly value: string | null;
  readonly label: string;
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string | null;
  onChange(v: string | null): void;
}) {
  return (
    <ToggleGroup
      variant="segmented"
      value={[String(value)]}
      onValueChange={(next: string[]) => {
        const picked = options.find((o) => String(o.value) === next[0]);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem key={String(o.value)} value={String(o.value)}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
  mono,
}: {
  label: string;
  options: Option[];
  value: string | null;
  onChange(v: string | null): void;
  mono?: boolean;
}) {
  return (
    <Select items={options} value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} className={cn("max-w-40", mono && "font-mono")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={o.value} className={cn(mono && o.value !== null && "font-mono")}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Text or number committed on blur or Enter; empty commits null when the field allows it. */
function CommitInput({
  label,
  value,
  numeric,
  nullable,
  onCommit,
}: {
  label: string;
  value: JsonValue | undefined;
  numeric: boolean;
  nullable: boolean;
  onCommit(v: JsonValue): void;
}) {
  const shown = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const commit = (text: string) => {
    if (text === shown) return;
    if (text.trim() === "") return nullable ? onCommit(null) : undefined;
    const next = numeric ? Number(text) : text;
    if (numeric && !Number.isFinite(next)) return;
    onCommit(next);
  };
  return (
    <Input
      key={shown}
      aria-label={label}
      defaultValue={shown}
      inputMode={numeric ? "decimal" : undefined}
      placeholder={nullable ? "auto" : undefined}
      className={cn("h-[22px] w-24", numeric && "text-right font-mono tabular-nums")}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
      }}
    />
  );
}

/** Base UI sliders report a number or, for ranges, an array; settings sliders have one thumb. */
const firstThumb = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit(v: number): void;
}) {
  const [live, setLive] = useState<number | null>(null);
  return (
    <div className="flex w-36 items-center gap-2">
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[live ?? value]}
        onValueChange={(v) => setLive(firstThumb(v))}
        onValueCommitted={(v) => {
          setLive(null);
          onCommit(firstThumb(v));
        }}
      />
      <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums">{live ?? value}</span>
    </div>
  );
}

/** The domain values a `control` string takes, from the dataset's catalog. */
function useCatalog(): Record<NonNullable<ConfigField["control"]>, string[]> {
  const { metadata } = useDatasetSession().state;
  return {
    column: metadata.obs_columns ?? [],
    obsm: Object.keys(metadata.obsm),
    dataset: metadata.dataset_keys ?? [],
  };
}

// ponytail: obsmKey is the only obsm field; a switch restarts the scatter on axes 0/1, 2D (as the chip does).
const AXES_RESET = { xDim: 0, yDim: 1, zDim: null };

function FieldControl({ id, field, props }: { id: string; field: ConfigField; props: Record<string, JsonValue> }) {
  const ws = useWorkspace();
  const catalog = useCatalog();
  const [key, child] = field.path;
  const top = props[key];
  const value =
    child === undefined ? top : top && typeof top === "object" && !Array.isArray(top) ? top[child] : undefined;
  const write = (next: JsonValue) => {
    const patch: Record<string, JsonValue> =
      child === undefined
        ? { [key]: next }
        : { [key]: { ...(top && typeof top === "object" && !Array.isArray(top) ? top : {}), [child]: next } };
    if (field.control === "obsm") Object.assign(patch, AXES_RESET);
    applyOrToast(ws, [{ op: "set_props", id, props: patch }]);
  };
  const none: Option[] = field.nullable ? [{ value: null, label: field.control === "column" ? "none" : "auto" }] : [];
  const { schema, title } = field;

  if (field.control) {
    const options = [...none, ...catalog[field.control].map((v) => ({ value: v, label: v }))];
    const current = typeof value === "string" ? value : null;
    return <Choice label={title} options={options} value={current} onChange={write} mono />;
  }
  if (schema instanceof z.ZodBoolean) {
    return <Switch aria-label={title} checked={value === true} onCheckedChange={(on) => write(on)} />;
  }
  if (schema instanceof z.ZodEnum) {
    const options = [...none, ...(schema.options as string[]).map((v) => ({ value: v, label: v }))];
    const current = typeof value === "string" ? value : null;
    return options.length <= 3 ? (
      <Segmented options={options} value={current} onChange={write} />
    ) : (
      <Choice label={title} options={options} value={current} onChange={write} />
    );
  }
  if (schema instanceof z.ZodNumber) {
    const { minValue: min, maxValue: max, format } = schema;
    // `.int()` implies the safe-integer range; only bounds the author set make a slider.
    if (
      !field.nullable &&
      typeof value === "number" &&
      min !== null &&
      max !== null &&
      Math.max(Math.abs(min), Math.abs(max)) < Number.MAX_SAFE_INTEGER
    ) {
      return (
        <RangeControl
          label={title}
          value={value}
          min={min}
          max={max}
          step={format === "safeint" ? 1 : (max - min) / 100}
          onCommit={write}
        />
      );
    }
    return <CommitInput label={title} value={value} numeric nullable={field.nullable} onCommit={write} />;
  }
  if (schema instanceof z.ZodString) {
    return <CommitInput label={title} value={value} numeric={false} nullable={field.nullable} onCommit={write} />;
  }
  // ponytail: arrays, records and unions have no generic control; a component marks them hidden or adds one on the view.
  return null;
}

function FieldRows({ id, element, fields }: { id: string; element: DashboardElement; fields: ConfigField[] }) {
  const props = componentProps(element);
  return fields.map((field) => (
    <Row key={field.path.join(".")} label={field.title}>
      <FieldControl id={id} field={field} props={props} />
    </Row>
  ));
}

/* ── tabs ──────────────────────────────────────────────────────────── */

function SourceRow({ id, element }: { id: string; element: DashboardElement }) {
  const ws = useWorkspace();
  const data = useWorkspaceSelector((w) => w.snapshot().data);
  const options: Option[] = [
    { value: null, label: "All obs" },
    ...Object.keys(data).map((name) => ({ value: name, label: name })),
  ];
  return (
    <Row label="Source">
      <Choice
        label="Source"
        options={options}
        value={elementData(element) ?? null}
        onChange={(data) => applyOrToast(ws, [{ op: "set_props", id, props: { data } }])}
      />
    </Row>
  );
}

function LinksTab({ id, element }: { id: string; element: DashboardElement }) {
  const ws = useWorkspace();
  const binds = COMPONENTS[element.type]?.binds ?? [];
  if (binds.length === 0) return <Empty>This view joins no links.</Empty>;
  return (
    <>
      <div className="pt-1 pb-1 text-xs font-medium text-text-muted">Shared scopes</div>
      {binds.map((type) => {
        const scope = elementScope(element, type);
        return (
          <Row key={type} label={LINK_LABEL[type]}>
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-text-muted">
              {scope === undefined ? (
                "not linked"
              ) : (
                <>
                  <span className={cn("size-1.5 shrink-0 rounded-full", LINK_DOT[type])} />
                  <span className="truncate font-mono">{scope}</span>
                </>
              )}
            </span>
            <Switch
              aria-label={`Link ${LINK_LABEL[type]}`}
              checked={scope !== undefined}
              onCheckedChange={(on) =>
                applyOrToast(ws, [
                  on
                    ? { op: "bind", id, type, scope: sharedScope(ws.snapshot(), type, id) }
                    : { op: "unbind", id, type },
                ])
              }
            />
          </Row>
        );
      })}
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="py-2.5 text-text-muted">{children}</div>;
}

/* ── popover ───────────────────────────────────────────────────────── */

function TitleInput({ id, element }: { id: string; element: DashboardElement }) {
  const ws = useWorkspace();
  const own = typeof element.props.title === "string" ? element.props.title : "";
  const commit = (text: string) => {
    const title = text.trim();
    if (title !== own) applyOrToast(ws, [{ op: "set_props", id, props: { title: title || null } }]);
  };
  return (
    <Input
      key={own}
      aria-label="View title"
      defaultValue={own}
      placeholder={COMPONENTS[element.type]?.title ?? element.type}
      className="-ml-1.5 h-[26px] flex-1 bg-transparent px-1.5 font-semibold text-md focus-visible:bg-muted focus-visible:ring-0"
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function SettingsBody({ id, element, close }: { id: string; element: DashboardElement; close(): void }) {
  const ws = useWorkspace();
  const info = COMPONENTS[element.type];
  const fields = configFields(info?.props ?? z.object({}));
  const display = fields.filter((f) => f.section === "display");
  const data = fields.filter((f) => f.section === "data");
  const act = (run: () => void) => () => {
    close();
    run();
  };
  return (
    <>
      <div className="flex items-center gap-1.5 pt-1 pr-0.5 pl-2.5">
        <TitleInput id={id} element={element} />
        <IconButton size="md" label="Close" onClick={close}>
          <X />
        </IconButton>
      </div>
      <Tabs defaultValue="display" className="flex min-h-0 flex-col gap-2">
        <TabsList className="mx-1 flex">
          {["Display", "Data", "Links"].map((tab) => (
            <TabsTrigger key={tab} value={tab.toLowerCase()} className="flex-1 justify-center">
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="max-h-80 overflow-y-auto px-2.5">
          <TabsContent value="display">
            {display.length === 0 ? (
              <Empty>Nothing to set here; this view's controls sit on the view.</Empty>
            ) : (
              <FieldRows id={id} element={element} fields={display} />
            )}
          </TabsContent>
          <TabsContent value="data">
            {info?.reads ? <SourceRow id={id} element={element} /> : null}
            <FieldRows id={id} element={element} fields={data} />
          </TabsContent>
          <TabsContent value="links">
            <LinksTab id={id} element={element} />
          </TabsContent>
        </div>
      </Tabs>
      <div className="-mx-1.5 -mb-1.5 flex items-center gap-0.5 border-border border-t-(length:--keyline) px-1.5 py-1.5">
        <IconButton size="md" label="Copy reference for the harness" onClick={act(() => void copyReference(ws, id))}>
          <Link />
        </IconButton>
        <IconButton size="md" label="Fullscreen" onClick={act(() => ws.setFullscreen(id))}>
          <Maximize2 />
        </IconButton>
        <IconButton
          size="md"
          label="Duplicate"
          description="Joins the same links"
          onClick={act(() =>
            applyOrToast(ws, [
              { op: "add", type: element.type, props: element.props, at: { beside: id, side: "right" } },
            ]),
          )}
        >
          <CopyIcon />
        </IconButton>
        <span className="flex-1" />
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-sm px-2 py-1 text-destructive hover:bg-muted [&_svg]:size-3.5 [&_svg]:stroke-[1.5]"
          onClick={act(() => applyOrToast(ws, [{ op: "remove", id }]))}
        >
          <Trash2 />
          Remove
        </button>
      </div>
    </>
  );
}

/** A press in a select opened from the popover is not outside it. */
const NESTED_POPUP = "[data-slot=select-content]";

/** The gear in a view's tile header and its settings popover. */
export function ViewSettingsButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const element = useWorkspaceSelector((w) => w.element(id));
  if (!element) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        const { event, reason } = details;
        const target = event instanceof FocusEvent ? event.relatedTarget : event.target;
        if (
          !next &&
          (reason === "outside-press" || reason === "focus-out") &&
          target instanceof Element &&
          target.closest(NESTED_POPUP)
        )
          return details.cancel();
        setOpen(next);
      }}
    >
      <HoverTip
        label="View settings"
        render={
          <PopoverTrigger
            aria-label="View settings"
            className={iconButtonVariants({ size: "md" })}
            onPointerDown={(e) => e.stopPropagation()}
          />
        }
      >
        <Settings strokeWidth={1.5} />
      </HoverTip>
      <PopoverContent align="end" className="gap-2 px-0 pt-1.5">
        <SettingsBody id={id} element={element} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
