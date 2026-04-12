import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { EmbeddingPicker } from "@/components/mudata/EmbeddingPicker";
import { VarSearchPanel } from "@/components/mudata/VarSearchPanel";
import { MultiPanelPreview } from "@/components/mudata/MultiPanelPreview";

// ── Mock data ────────────────────────────────────────────────────────────────

const mockObsm = {
  "rna:X_umap": { prefix: "rna_umap", n_dims: 2, loaded: true, modality: "rna" },
  "rna:X_pca": { prefix: "rna_pca", n_dims: 50, loaded: false, modality: "rna" },
  "dinov2:X_umap": { prefix: "dinov2_umap", n_dims: 2, loaded: true, modality: "dinov2" },
  "dinov2:X_pca": { prefix: "dinov2_pca", n_dims: 50, loaded: false, modality: "dinov2" },
  "dinov2:X_phate": { prefix: "dinov2_phate", n_dims: 2, loaded: false, modality: "dinov2" },
};

const mockModalities = ["rna", "dinov2"];

// ── Section wrapper ──────────────────────────────────────────────────────────

function SketchSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-sm font-medium text-text-primary">{title}</h2>
        <p className="mt-1 text-text-muted text-xs leading-relaxed">{description}</p>
      </div>
      <div className="rounded-lg border border-border-subtle bg-surface p-6">{children}</div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SketchPage() {
  const [activeEmbedding, setActiveEmbedding] = useState("rna:X_umap");

  return (
    <div className="dark min-h-screen bg-base p-8 font-sans text-text-primary">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <h1 className="font-heading text-lg font-semibold text-text-primary">MuData UI Sketches</h1>
          <p className="mt-1 text-text-secondary text-sm">Design explorations for multi-modal data support (MuData).</p>
        </header>

        <div className="flex flex-col gap-8">
          {/* 1. Embedding Picker */}
          <SketchSection
            title="1. Embedding Picker"
            description="Popover-based embedding selector grouped by modality. Shows loaded state, dimension count, and modality badges."
          >
            <div className="flex items-center gap-3">
              <span className="text-text-muted text-xs">Embedding:</span>
              <EmbeddingPicker obsm={mockObsm} activeKey={activeEmbedding} onSelect={setActiveEmbedding} />
              <span className="text-text-muted text-[10px]">
                Selected: <code className="font-mono text-text-secondary">{activeEmbedding}</code>
              </span>
            </div>
          </SketchSection>

          <Separator />

          {/* 2. Var Search Panel */}
          <SketchSection
            title="2. Var Search Panel"
            description="Command palette for searching variables across modalities. Supports modality tabs, server-side search, and layer selection."
          >
            <div className="flex gap-6">
              <div>
                <p className="mb-2 text-text-muted text-[10px]">With modality tabs:</p>
                <VarSearchPanel
                  modalities={mockModalities}
                  activeModality="rna"
                  onSelectVar={(v, l, m) => console.log("select", v, l, m)}
                />
              </div>
              <div>
                <p className="mb-2 text-text-muted text-[10px]">Single modality:</p>
                <VarSearchPanel onSelectVar={(v, l) => console.log("select", v, l)} />
              </div>
            </div>
          </SketchSection>

          <Separator />

          {/* 3. Multi-Panel Preview */}
          <SketchSection
            title="3. Multi-Panel Cross-Filter"
            description="Two scatter panels showing cross-filter highlighting. Lasso selection in one modality highlights corresponding observations in the other."
          >
            <MultiPanelPreview />
          </SketchSection>
        </div>
      </div>
    </div>
  );
}
