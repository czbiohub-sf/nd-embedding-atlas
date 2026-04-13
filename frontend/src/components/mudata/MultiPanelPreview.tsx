import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface DotProps {
  x: string;
  y: string;
  highlighted: boolean;
  color: string;
}

// ── Simulated scatter dots ───────────────────────────────────────────────────

function Dot({ x, y, highlighted, color }: DotProps) {
  return (
    <div
      className={cn(
        "absolute size-2 rounded-full transition-opacity duration-200",
        highlighted ? "opacity-100" : "opacity-20",
      )}
      style={{ left: x, top: y, backgroundColor: color }}
    />
  );
}

// ── Scatter panel mock ───────────────────────────────────────────────────────

function ScatterPanel({
  modality,
  embeddingLabel,
  badgeColor,
  dots,
}: {
  modality: string;
  embeddingLabel: string;
  badgeColor: string;
  dots: DotProps[];
}) {
  return (
    <div className="flex flex-1 flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn("text-[9px]", badgeColor)}>
          {modality}
        </Badge>
        <span className="font-mono text-text-secondary text-xs">{embeddingLabel}</span>
      </div>

      {/* Scatter area */}
      <div className="relative aspect-square w-full rounded-md bg-base">
        {dots.map((dot, i) => (
          <Dot key={i} {...dot} />
        ))}

        {/* Lasso indicator */}
        <div className="pointer-events-none absolute inset-x-[25%] inset-y-[20%] rounded border border-dashed border-accent-cyan/40" />
      </div>

      <span className="text-center text-text-muted text-[10px]">
        {dots.filter((d) => d.highlighted).length} / {dots.length} selected
      </span>
    </div>
  );
}

// ── Cross-filter arrow ───────────────────────────────────────────────────────

function CrossFilterArrow() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-2">
      <svg width="32" height="16" viewBox="0 0 32 16" className="text-accent-cyan">
        <path
          d="M2 8h22M20 4l6 4-6 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-text-muted text-[9px]">cross-filter</span>
      <svg width="32" height="16" viewBox="0 0 32 16" className="text-accent-cyan">
        <path
          d="M30 8H8M12 4L6 8l6 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ── Dot data ─────────────────────────────────────────────────────────────────

const RNA_DOTS: DotProps[] = [
  { x: "20%", y: "30%", highlighted: true, color: "#06b6d4" },
  { x: "25%", y: "45%", highlighted: true, color: "#06b6d4" },
  { x: "35%", y: "35%", highlighted: true, color: "#06b6d4" },
  { x: "30%", y: "55%", highlighted: true, color: "#06b6d4" },
  { x: "40%", y: "40%", highlighted: true, color: "#06b6d4" },
  { x: "60%", y: "25%", highlighted: false, color: "#06b6d4" },
  { x: "70%", y: "60%", highlighted: false, color: "#06b6d4" },
  { x: "55%", y: "70%", highlighted: false, color: "#06b6d4" },
  { x: "75%", y: "45%", highlighted: false, color: "#06b6d4" },
  { x: "65%", y: "75%", highlighted: false, color: "#06b6d4" },
  { x: "80%", y: "30%", highlighted: false, color: "#06b6d4" },
  { x: "45%", y: "65%", highlighted: false, color: "#06b6d4" },
];

const DINOV2_DOTS: DotProps[] = [
  { x: "30%", y: "25%", highlighted: true, color: "#a78bfa" },
  { x: "35%", y: "40%", highlighted: true, color: "#a78bfa" },
  { x: "40%", y: "30%", highlighted: true, color: "#a78bfa" },
  { x: "25%", y: "50%", highlighted: true, color: "#a78bfa" },
  { x: "45%", y: "45%", highlighted: true, color: "#a78bfa" },
  { x: "65%", y: "35%", highlighted: false, color: "#a78bfa" },
  { x: "70%", y: "55%", highlighted: false, color: "#a78bfa" },
  { x: "60%", y: "65%", highlighted: false, color: "#a78bfa" },
  { x: "75%", y: "40%", highlighted: false, color: "#a78bfa" },
  { x: "80%", y: "70%", highlighted: false, color: "#a78bfa" },
  { x: "55%", y: "75%", highlighted: false, color: "#a78bfa" },
  { x: "50%", y: "60%", highlighted: false, color: "#a78bfa" },
];

// ── Main component ───────────────────────────────────────────────────────────

export function MultiPanelPreview() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ScatterPanel
          modality="rna"
          embeddingLabel="umap"
          badgeColor="border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
          dots={RNA_DOTS}
        />
        <CrossFilterArrow />
        <ScatterPanel
          modality="dinov2"
          embeddingLabel="umap"
          badgeColor="border-violet-500/30 bg-violet-500/15 text-violet-400"
          dots={DINOV2_DOTS}
        />
      </div>

      <Separator />

      <p className="text-text-muted text-xs leading-relaxed">
        Cross-filter selection: lasso in one panel highlights corresponding observations in the other. Shared{" "}
        <code className="font-mono text-text-secondary">obs_index</code> links modalities.
      </p>
    </div>
  );
}
