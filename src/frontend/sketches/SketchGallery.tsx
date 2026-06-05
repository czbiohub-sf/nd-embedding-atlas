/**
 * SketchGallery — THROWAWAY design exploration. Not part of the product.
 *
 * Reachable only via ?sketch=a|b|c (gated in main.tsx). Mocks the embedding-atlas
 * surfaces under the BRAND-ALIGNED "Graphic-Realism Instrument" language:
 *   • accent = exact Biohub periwinkle #6E4FF9, used sparingly (interactive-only)
 *   • foundational black + white, chrome grayscale, data owns chroma
 *   • brackets [ ] are the signature device — frame the canvas, wrap numeric readouts
 *   • solid stepped surfaces (no glass/gradient), DM Sans (UI) + Geist Mono (data)
 *
 *   a = DARK / INSTRUMENT  (data-exploration mode; on-brand dark exception)
 *   b = LIGHT / TECHNICAL  (brand-canonical: 70% white · 20% black · ≤10% periwinkle)
 *   c = DARK / MINIMAL     (least signage — baseline)
 *
 * Tokens are remapped on the wrapper so real shadcn utilities render in the new
 * language. Delete this folder + the main.tsx gate to remove.
 */
import { Brackets, ChartScatter, Database, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { BiohubMark } from "../components/BiohubMark";

type Variant = "a" | "b";

const PERIWINKLE = "#6E4FF9"; // Biohub brand accent (exact)

interface VariantSpec {
  id: Variant;
  name: string;
  blurb: string;
  mode: "dark" | "light";
  signage: "full" | "min";
  vars: Record<string, string>;
}

const DARK_VARS: Record<string, string> = {
  "--background": "oklch(0.14 0.004 277)",
  "--foreground": "oklch(0.97 0 0)",
  "--card": "oklch(0.175 0.004 277)",
  "--card-foreground": "oklch(0.97 0 0)",
  "--popover": "oklch(0.2 0.004 277)",
  "--popover-foreground": "oklch(0.97 0 0)",
  "--muted": "oklch(0.25 0.004 277)",
  "--muted-foreground": "oklch(0.66 0 0)",
  "--accent": "oklch(0.25 0.004 277)",
  "--accent-foreground": "oklch(0.97 0 0)",
  "--border": "oklch(1 0 0 / 0.1)",
  "--input": "oklch(1 0 0 / 0.12)",
  "--primary": PERIWINKLE,
  "--primary-foreground": "#ffffff",
  "--ring": "oklch(0.554 0.236 281 / 0.6)",
  "--radius": "0.25rem",
};

const LIGHT_VARS: Record<string, string> = {
  "--background": "#ffffff",
  "--foreground": "oklch(0.16 0 0)",
  "--card": "oklch(0.99 0 0)",
  "--card-foreground": "oklch(0.16 0 0)",
  "--popover": "#ffffff",
  "--popover-foreground": "oklch(0.16 0 0)",
  "--muted": "oklch(0.965 0 0)",
  "--muted-foreground": "oklch(0.45 0 0)",
  "--accent": "oklch(0.95 0 0)",
  "--accent-foreground": "oklch(0.16 0 0)",
  "--border": "oklch(0 0 0 / 0.12)",
  "--input": "oklch(0 0 0 / 0.15)",
  "--primary": PERIWINKLE,
  "--primary-foreground": "#ffffff",
  "--ring": "oklch(0.554 0.236 281 / 0.5)",
  "--radius": "0.25rem",
};

const VARIANTS: Record<Variant, VariantSpec> = {
  a: {
    id: "a",
    name: "A · DARK / INSTRUMENT",
    blurb:
      "Data-exploration mode — near-black, periwinkle accent, bracket-framed canvas + readouts. The on-brand dark exception.",
    mode: "dark",
    signage: "full",
    vars: DARK_VARS,
  },
  b: {
    id: "b",
    name: "B · LIGHT / TECHNICAL (brand)",
    blurb:
      "Brand-canonical technical mode — 70% white · 20% black · ≤10% periwinkle. What the brand book actually prescribes.",
    mode: "light",
    signage: "full",
    vars: LIGHT_VARS,
  },
};

// ── Bracket primitives — the brand's signature device ────────────────
/** Inline bracketed text: [content], flush, same color/weight as surrounding text. */
function Bk({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono">
      <span className="opacity-50">[</span>
      {children}
      <span className="opacity-50">]</span>
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{children}</span>;
}

/** Compose any lucide icon inside the brand's brackets — [icon].
 * Brackets are stretched horizontally so the inner glyph reads larger. */
function BracketIcon({ icon: Icon, className = "size-6" }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center ${className}`}>
      <Brackets className="absolute inset-0 size-full scale-x-[1.35]" strokeWidth={1.5} />
      <Icon className="size-[62%]" strokeWidth={2} />
    </span>
  );
}

function Chip({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 font-mono text-[11px] transition-colors ${
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground/85 hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

const TABLE_COLS = ["fov_name", "track_id", "t", "predicted_organelle_state_g3bp1", "predicted_infection_state"];
const TABLE_ROWS = [
  ["A/1/000000", "35", "25", "remodel", "uninfected"],
  ["A/1/000000", "35", "26", "remodel", "uninfected"],
  ["A/1/000000", "35", "28", "remodel", "infected"],
  ["A/1/000000", "35", "31", "noremodel", "infected"],
  ["A/1/000000", "35", "33", "remodel", "uninfected"],
];

function colWidth(c: string): number {
  return c.length > 14 ? 220 : c.length > 8 ? 150 : 90;
}

function Surface({ spec }: { spec: VariantSpec }) {
  const light = spec.mode === "light";
  // data colors — data owns the chroma; nudge stronger on white so it reads
  const blue = light ? "oklch(0.55 0.2 250)" : "oklch(0.64 0.16 250)";
  const amber = light ? "oklch(0.68 0.16 65)" : "oklch(0.78 0.14 70)";

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground" style={spec.vars as CSSProperties}>
      {/* ── Scatter region (FULL height) — chrome floats on top ── */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              `radial-gradient(ellipse 30% 26% at 54% 46%, ${amber.replace(")", " / 0.5)")}, transparent 70%),` +
              `radial-gradient(ellipse 26% 30% at 47% 52%, ${blue.replace(")", " / 0.5)")}, transparent 70%),` +
              `radial-gradient(ellipse 60% 55% at 52% 50%, ${light ? "oklch(0.7 0.03 277 / 0.12)" : "oklch(0.5 0.04 277 / 0.16)"}, transparent 75%)`,
          }}
        />

        {/* floating controls — imposed directly on the canvas, no bar behind them */}
        <div className="absolute top-0 right-0 left-0 z-20 flex items-center gap-2 px-3 py-2.5">
          <BracketIcon icon={ChartScatter} className="mr-1 size-6 text-foreground/75" />
          <Chip active>
            <Bk>phate</Bk>
          </Chip>
          <span className="font-mono text-[10px] text-muted-foreground">X</span>
          <Chip>0</Chip>
          <span className="font-mono text-[10px] text-muted-foreground">Y</span>
          <Chip>1</Chip>
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">COL</span>
          <Chip>predicted_infection_state</Chip>
          <div className="ml-auto flex items-center gap-1.5">
            {["▦", "◫", "◰", "⤢", "✕"].map((g, i) => (
              <button
                key={i}
                type="button"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span className="text-[13px] leading-none">{g}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="absolute top-14 right-6 font-mono text-[10px] text-muted-foreground/80">
          <Bk>OBS · 70,121</Bk>
        </div>

        {/* Legend — floats top-left, solid surface, no glass */}
        <div className="absolute top-14 left-6 w-56 rounded-md border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-border/70 border-b px-2.5 py-1.5">
            <Label>Categories · 2</Label>
            <button
              type="button"
              className="rounded-sm px-1 py-0.5 font-mono text-[10px] text-muted-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              tab10 ▾
            </button>
          </div>
          <div className="p-1.5 font-mono text-[11px]">
            {[
              ["infected", "39,217", blue],
              ["uninfected", "30,904", amber],
            ].map(([name, count, color]) => (
              <div
                key={name}
                className="group flex items-center justify-between rounded-sm py-1 pr-1 pl-1.5 transition-colors hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[2px]" style={{ background: color }} />
                  <span>{name}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table — floating card panel (like the Collections sidebar) ── */}
      <div className="absolute inset-x-4 bottom-8 z-30 flex h-[300px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-border border-b px-3 py-2.5">
          <BracketIcon icon={Database} className="size-6 text-primary" />
          {["TABLE", "TRACK", "GALLERY"].map((t, i) => (
            <button
              key={t}
              type="button"
              className={`relative rounded-sm px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                i === 0
                  ? "text-foreground after:absolute after:inset-x-2 after:-bottom-1.5 after:h-px after:bg-primary"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
            <Bk>ROWS · 70,121</Bk>
          </span>
          <button
            type="button"
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="text-[12px] leading-none">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {/* header */}
          <div className="sticky top-0 z-10 flex border-border border-b bg-card">
            {TABLE_COLS.map((c) => (
              <div
                key={c}
                className="shrink-0 truncate px-2 py-1.5 font-medium font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
                style={{ width: colWidth(c) }}
                title={c}
              >
                {c}
              </div>
            ))}
          </div>
          {/* rows */}
          {TABLE_ROWS.map((row, ri) => (
            <div
              key={ri}
              className={`group flex border-border/40 border-b font-mono text-[11px] transition-colors ${
                ri === 2 ? "bg-primary/10" : "hover:bg-muted"
              }`}
            >
              {row.map((cell, ci) => {
                const isState = ci === 4;
                const isInfected = cell === "infected";
                return (
                  <div
                    key={ci}
                    className="relative shrink-0 truncate px-2 py-1.5 tabular-nums text-foreground/90"
                    style={{ width: colWidth(TABLE_COLS[ci]) }}
                  >
                    {ri === 2 && ci === 0 && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                    {isState ? (
                      <span
                        className="rounded-[3px] px-1.5 py-0.5 text-[10px]"
                        style={{
                          background: isInfected ? blue.replace(")", " / 0.18)") : amber.replace(")", " / 0.18)"),
                          color: isInfected
                            ? light
                              ? blue
                              : "oklch(0.8 0.1 250)"
                            : light
                              ? amber
                              : "oklch(0.85 0.1 70)",
                        }}
                      >
                        {cell}
                      </span>
                    ) : (
                      cell
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* footer — keyboard hint, like the Collections card */}
        <div className="flex items-center justify-between border-border border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1.5">
            Toggle <kbd className="rounded border border-border bg-muted px-1 py-px text-[9px]">⌘J</kbd>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-border bg-muted px-1 py-px text-[9px]">Esc</kbd> to close
          </span>
        </div>
      </div>

      {/* ── Status bar — HUD, bracketed readouts ─────────────── */}
      <div className="flex items-center gap-2.5 border-border border-t bg-card px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">phate</span>
        <span className="opacity-40">·</span>
        <Bk>OBS · 70,121</Bk>
        <span className="opacity-40">·</span>
        <Bk>FPS · 60</Bk>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: PERIWINKLE }} />
          <Bk>READY</Bk>
        </span>
        <span className="text-muted-foreground/30">·</span>
        <BiohubMark className="h-3.5 w-auto shrink-0 text-primary" title="Biohub" />
      </div>
    </div>
  );
}

export function SketchGallery({ variant = "a" }: { variant?: string }) {
  const spec = VARIANTS[(variant as Variant) in VARIANTS ? (variant as Variant) : "a"];
  return (
    <div className="sketch-root fixed inset-0">
      {/* mono = Geist Mono (the app's --font-mono); HUD readouts use font-hud = Geist Pixel. */}

      {/* preview-only: scale the whole UI to 85% (uniform) — over-size by 1/0.85 so it still fills the viewport */}
      <div style={{ transform: "scale(0.85)", transformOrigin: "top left", width: "117.647%", height: "117.647%" }}>
        <Surface spec={spec} />
      </div>

      {/* throwaway dev switcher — tiny floating pill, bottom-right, out of the way */}
      <div
        className="fixed top-14 right-3 z-50 flex items-center gap-0.5 rounded-md border px-1 py-1 font-mono text-[10px]"
        style={{ background: "#0a0a0c", color: "#f5f5f7", borderColor: "rgba(255,255,255,0.12)" }}
        title={spec.blurb}
      >
        <span className="px-1 uppercase tracking-[0.14em] opacity-40">sketch</span>
        {(["a", "b"] as const).map((v) => (
          <a
            key={v}
            href={`?sketch=${v}`}
            className="rounded-sm px-1.5 py-0.5 uppercase transition-colors"
            style={v === spec.id ? { background: PERIWINKLE, color: "#fff" } : { opacity: 0.55 }}
            title={VARIANTS[v].name}
          >
            {v}
          </a>
        ))}
      </div>
    </div>
  );
}
