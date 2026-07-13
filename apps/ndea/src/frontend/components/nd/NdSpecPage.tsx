/**
 * NdSpecPage — dev-only living spec for the nd component layer, at #/nd-spec.
 * Mirrors design_handoff_node_workspace/component-spec/ (the contract source).
 * No data dependencies — renders without a backend.
 */

import { useState } from "react";

import { NdIconButton } from "./nd-icon-button";
import { ND_ICONS, type NdIconName } from "./nd-icons";
import { NdNodeFrame } from "./nd-node-frame";
import { ND_PORT_KINDS, NdPort, type NdPortKind, type NdPortProps, type NdPortState } from "./nd-port";
import { NdChip, NdHud } from "./nd-primitives";
import { NdBreadcrumb } from "./nd-breadcrumb";
import { NdHistoMock, NdScatterMock } from "./nd-mocks";
import type { NdForm } from "./nd-resolve-form";

const demoPorts = (out = true, kind: NdPortKind = "pred"): NdPortProps[] => [
  { side: "left", kind: "pred" },
  ...(out ? [{ side: "right" as const, kind, out: true }] : []),
];

function SpecLabel({ children }: { children: React.ReactNode }) {
  return <span className="block font-hud text-[9px] tracking-[0.04em] text-text-muted uppercase">{children}</span>;
}

function DemoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-center gap-2">
      <span className="text-[10.5px] text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function DemoSelect({ value }: { value: string }) {
  return (
    <span className="flex items-center justify-between rounded border border-border bg-muted px-[7px] py-[3px] font-mono text-[10.5px] text-foreground">
      {value}
      <span className="text-[8px] text-text-muted">▾</span>
    </span>
  );
}

/* ── hero: interactive form cycler ───────────────────────────────── */
function HeroDemo() {
  const [form, setForm] = useState<NdForm>("full");
  const [locked, setLocked] = useState(false);
  const sizes: Record<NdForm, { w: number; h?: number }> = {
    chip: { w: 148 },
    card: { w: 236, h: 104 },
    full: { w: 258, h: 208 },
  };
  const s = sizes[form];
  return (
    <div className="flex min-h-[250px] items-start gap-9">
      <NdNodeFrame
        nodeId="demo-thr"
        form={form}
        w={s.w}
        h={s.h}
        label="Threshold Filter"
        led="clean"
        count="412,809"
        locked={locked}
        onCycleForm={() => setForm(form === "chip" ? "card" : form === "card" ? "full" : "chip")}
        onToggleLock={() => setLocked(!locked)}
        footer={
          <>
            <span>epoch 0142</span>
            <span>cook 2.1ms</span>
            <span className="ml-auto">pass 17.1%</span>
          </>
        }
        ports={demoPorts()}
      >
        {form === "full" ? <NdHistoMock w={236} /> : null}
        <DemoRow label="column">
          <DemoSelect value="area_um2" />
        </DemoRow>
        <DemoRow label="threshold">
          <div className="flex items-center gap-2">
            <div className="relative h-[3px] flex-1 rounded-sm bg-surface-tertiary">
              <div className="h-full w-[42%] rounded-sm bg-primary" />
              <span className="absolute top-1/2 left-[42%] size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary" />
            </div>
            <span className="font-mono text-[10.5px]">240</span>
          </div>
        </DemoRow>
      </NdNodeFrame>
      <div className="max-w-[280px]">
        <SpecLabel>live — cycle the form, lock it against zoom</SpecLabel>
        <p className="mt-2 text-xs text-muted-foreground">
          One component, one DOM element, three forms. The host resolves the form from zoom + placement + override; the
          frame morphs width/height (220 ms) and the body content cross-fades (200 ms). Ports ride the morphing edge.
        </p>
      </div>
    </div>
  );
}

/* ── three forms side by side ────────────────────────────────────── */
function FormsDemo() {
  return (
    <div className="flex flex-wrap items-end gap-[30px]">
      <div className="w-[148px] shrink-0">
        <SpecLabel>chip — 26px · canonical width</SpecLabel>
        <div className="mt-2">
          <NdNodeFrame
            nodeId="f1"
            form="chip"
            w={148}
            label="Threshold Filter"
            led="clean"
            count="412,809"
            ports={demoPorts()}
          />
        </div>
      </div>
      <div className="w-[236px] shrink-0">
        <SpecLabel>card — config / thumbnail · resizable</SpecLabel>
        <div className="mt-2">
          <NdNodeFrame
            nodeId="f2"
            form="card"
            w={236}
            h={104}
            label="Threshold Filter"
            led="clean"
            count="412,809"
            ports={demoPorts()}
            onResize={() => {}}
          >
            <DemoRow label="column">
              <DemoSelect value="area_um2" />
            </DemoRow>
            <DemoRow label="threshold">
              <span className="font-mono text-[10.5px]">≥ 240</span>
            </DemoRow>
          </NdNodeFrame>
        </div>
      </div>
      <div className="w-[258px] shrink-0">
        <SpecLabel>full — live body + footer · resizable</SpecLabel>
        <div className="mt-2">
          <NdNodeFrame
            nodeId="f3"
            form="full"
            w={258}
            h={196}
            label="Threshold Filter"
            led="clean"
            count="412,809"
            ports={demoPorts()}
            onResize={() => {}}
            footer={
              <>
                <span>epoch 0142</span>
                <span>cook 2.1ms</span>
              </>
            }
          >
            <NdHistoMock w={236} />
            <DemoRow label="column">
              <DemoSelect value="area_um2" />
            </DemoRow>
          </NdNodeFrame>
        </div>
      </div>
    </div>
  );
}

/* ── state matrix ────────────────────────────────────────────────── */
const mk = (label: string, props: Partial<React.ComponentProps<typeof NdNodeFrame>>) => (
  <div key={label} className="flex flex-col items-start gap-2">
    <SpecLabel>{label}</SpecLabel>
    <NdNodeFrame nodeId={`s-${label}`} form="card" w={196} h={86} label="Scatter A" {...props}>
      <NdScatterMock width={176} height={34} seed={7} />
    </NdNodeFrame>
  </div>
);

function StateMatrix() {
  return (
    <div className="grid grid-cols-3 gap-x-5 gap-y-[26px]">
      {mk("default · clean", { led: "clean", count: "412,809" })}
      {mk("selected", { led: "clean", selected: true })}
      {mk("claimed (pointer)", { led: "clean", claimed: true })}
      {mk("dirty — awaiting pull", { led: "dirty" })}
      {mk("cooking", { led: "cooking" })}
      {mk("error", { led: "error" })}
      {mk("staged — body elsewhere", { led: "clean", staged: true })}
      {mk("stale (selection)", { led: "clean", stale: true, badge: <NdChip tone="amber">◇</NdChip> })}
      {mk("telemetry off", { led: null, count: "412,809" })}
    </div>
  );
}

/* ── ports reference ─────────────────────────────────────────────── */
function PortsDemo() {
  const row = (kind: NdPortKind, dir: "in" | "out", state: NdPortState, note: string) => (
    <div
      key={kind + dir + state}
      className="grid grid-cols-[120px_60px_1fr] items-center gap-4 border-b border-border py-2"
    >
      <SpecLabel>
        {ND_PORT_KINDS[kind].label} · {dir}
        {state !== "idle" ? ` · ${state}` : ""}
      </SpecLabel>
      <span className="relative block h-3.5">
        <NdPort side="left" y={7} kind={kind} out={dir === "out"} state={state} />
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
  return (
    <div className="py-3.5">
      {row("pred", "out", "idle", "filled circle — emits a predicate (pull wire, periwinkle)")}
      {row("pred", "in", "idle", "hollow circle — accepts predicates; owns the fan-in operator chip")}
      {row("sel", "out", "idle", "diamond — user-driven selection (push wire, amber); lasso source")}
      {row("focus", "out", "idle", "square — single-record focus (push wire, sky); table → FOV")}
      {row("pred", "in", "legal", "legal drop target during a wire drag — green glow")}
      {row("pred", "in", "illegal", "kind mismatch / cycle / duplicate — dimmed to 30%")}
      {row("sel", "out", "source", "origin of the live wire drag — kind-colored ring")}
    </div>
  );
}

/* ── the page ────────────────────────────────────────────────────── */
export function NdSpecPage() {
  const iconSample: NdIconName[] = [
    "form-chip",
    "form-card",
    "form-full",
    "lock-open",
    "lock",
    "config",
    "split",
    "pin-up",
    "pin-down",
    "close",
    "freeze",
    "lasso",
    "enter",
    "up",
    "tidy",
    "bypass",
    "power",
  ];
  return (
    <main className="mx-auto max-w-[860px] overflow-y-auto px-8 py-10 pb-24">
      <h1 className="mb-1 text-xl font-semibold">NdNode</h1>
      <p className="mb-1.5 text-text-muted">
        The standard node container — one component, three forms. Consumed by the canvas, stage tiles, and any future
        surface. Companion: <span className="font-mono text-2xs">.design/VOCABULARY.md</span>.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Anatomy &amp; live behavior</h2>
      <HeroDemo />
      <p className="mt-3 max-w-[70ch] text-xs text-muted-foreground">
        Header (26px, never wraps): <b className="text-foreground">LED · label · badge · sub</b> on the left,
        <b className="text-foreground"> form controls · actions · count</b> on the right. Body is plugin territory (10px
        padding). Footer (full form only) is host telemetry. Ports are absolutely positioned on the frame edge — outside
        the body, so they track the morph.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold">The three forms</h2>
      <FormsDemo />
      <p className="mt-3 max-w-[70ch] text-xs text-muted-foreground">
        Chips are <b className="text-foreground">canonical</b> — fixed height (26px), per-type width, never
        user-resized: the wiring diagram must stay tidy. Cards and full bodies are resizable (4 corner hotspots, SE
        glyph; min 150×90 / 200×140, max 780×720), with sizes stored <b className="text-foreground">per form</b> so card
        and full never contaminate each other.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold">States</h2>
      <StateMatrix />

      <h2 className="mt-8 mb-3 text-sm font-semibold">Ports</h2>
      <PortsDemo />
      <p className="mt-3 max-w-[70ch] text-xs text-muted-foreground">
        <b className="text-foreground">Outputs are already typed — the dot is the type.</b> Shape + color encode the
        kind (predicate ● circle · selection ◆ diamond · focus ▪ square); fill encodes direction (filled = out, hollow =
        in). A node that emits something new claims a <em>reserved</em> shape rather than redesigning the system. One
        kind per out-port; a node needing two output kinds gets two out-ports.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Icon buttons</h2>
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-start gap-2">
          {iconSample.map((n) => (
            <span key={n} className="inline-flex w-[58px] flex-col items-center gap-[5px]">
              <NdIconButton icon={n} title={n} />
              <SpecLabel>{n}</SpecLabel>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <NdIconButton icon="lock" active title="active (periwinkle)" />
          <NdIconButton icon="freeze" label="freeze" tone="amber" title="amber + label" />
          <NdIconButton icon="pin-up" label="stage" title="label variant" />
          <SpecLabel>states: default · active · amber · with mono label</SpecLabel>
        </div>
      </div>
      <p className="mt-3 max-w-[70ch] text-xs text-muted-foreground">
        <b className="text-foreground">Every header button is an NdIconButton</b> — a 15px (14px compact) grid-centered
        box with an icon from the shared <code className="font-mono">ND_ICONS</code> registry (
        {Object.keys(ND_ICONS).length} icons, 10×10 grid). Font glyphs are banned from buttons; new icons go in the
        registry. Plugins declare actions as data and the host renders them; nobody hand-styles a header button.
      </p>

      <h2 className="mt-8 mb-3 text-sm font-semibold">Breadcrumb</h2>
      <div className="flex items-center gap-6">
        <NdBreadcrumb
          items={[{ label: "atlas", onClick: () => {} }, { label: "qc", onClick: () => {} }, { label: "qc-thr" }]}
        />
        <SpecLabel>shadcn anatomy · mono 9.5px · current page in primary</SpecLabel>
      </div>

      <h2 className="mt-8 mb-3 text-sm font-semibold">HUD signage</h2>
      <div className="flex items-center gap-4">
        <NdHud size={10}>stage empty</NdHud>
        <NdHud size={9} className="text-primary">
          ST
        </NdHud>
        <NdHud size={8.5}>body on stage ◆</NdHud>
        <SpecLabel>geist pixel · uppercase · 8–10px</SpecLabel>
      </div>
    </main>
  );
}
