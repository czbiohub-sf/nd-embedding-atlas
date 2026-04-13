/**
 * SketchPage — renders all MuData UI sketches with mock data.
 * Standalone page for design review.
 */

import { useState } from "react";

import { Separator } from "@/components/ui/separator";
import { COLOR_NONE, type ColorSource, colorSourceObs } from "@/lib/color-source";

import { EmbeddingPicker } from "./EmbeddingPicker";
import { ModalityColorPicker } from "./ModalityColorPicker";
import { MultiPanelPreview } from "./MultiPanelPreview";

// ── Mock data ────────────────────────────────────────────────────────────────

const mockObsm = {
  "rna:X_umap": { prefix: "rna_umap", n_dims: 2, loaded: true, modality: "rna" },
  "rna:X_pca": { prefix: "rna_pca", n_dims: 50, loaded: false, modality: "rna" },
  "dinov2:X_umap": { prefix: "dinov2_umap", n_dims: 2, loaded: true, modality: "dinov2" },
  "dinov2:X_pca": { prefix: "dinov2_pca", n_dims: 50, loaded: false, modality: "dinov2" },
  "dinov2:X_phate": { prefix: "dinov2_phate", n_dims: 2, loaded: false, modality: "dinov2" },
};

const mockModalities = ["rna", "dinov2"];

const mockModalityObsColumns: Record<string, string[]> = {
  rna: ["phase", "S_score", "G2M_score", "condition", "lane", "experiment", "n_genes", "cage_crop_file_name"],
  dinov2: [
    "object_class",
    "cage_crop_file_name",
    "zarr_position",
    "zarr_path",
    "cage_global_x_um",
    "cage_global_y_um",
    "is_cell",
    "is_bead",
  ],
};

const mockAllObsColumns = [
  "cage_mates",
  ...mockModalityObsColumns.rna,
  ...mockModalityObsColumns.dinov2.filter((c) => !mockModalityObsColumns.rna.includes(c)),
];

const mockVarCount = { rna: 18144, dinov2: 768 };

// ── Page ─────────────────────────────────────────────────────────────────────

export function SketchPage() {
  const [activeKey, setActiveKey] = useState("rna:X_umap");
  const [colorSource, setColorSource] = useState<ColorSource>(COLOR_NONE);

  return (
    <div className="dark min-h-screen bg-base p-8 font-sans text-text-primary">
      <h1 className="mb-2 font-bold text-2xl">MuData UI Sketches</h1>
      <p className="mb-8 text-sm text-text-muted">
        Design explorations for multi-modal data support. Same cells, different feature spaces.
      </p>

      {/* ── Sketch 1: Embedding Picker ─────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 font-semibold text-lg">1. Embedding Picker</h2>
        <p className="mb-4 text-xs text-text-muted">Embeddings grouped by modality. Click to switch.</p>
        <div className="flex items-center gap-4">
          <span className="text-xs text-text-muted">Embedding:</span>
          <EmbeddingPicker obsm={mockObsm} activeKey={activeKey} onSelect={setActiveKey} />
          <span className="font-mono text-xs text-text-secondary">active: {activeKey}</span>
        </div>
      </section>

      <Separator className="mb-10" />

      {/* ── Sketch 2: Modality Color Picker ────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 font-semibold text-lg">2. Color Source Picker (cross-modality)</h2>
        <p className="mb-2 text-xs text-text-muted">
          Color by obs or var from ANY modality — independent of the active embedding.
        </p>
        <p className="mb-4 text-xs text-text-muted">
          Try: select &quot;phase&quot; (rna obs) while viewing dinov2 embedding → cross-modality indicator appears.
        </p>

        <div className="flex items-center gap-4">
          <span className="text-xs text-text-muted">Color by:</span>
          <ModalityColorPicker
            colorSource={colorSource}
            onSetColorSource={setColorSource}
            obsColumns={mockAllObsColumns}
            modalityObsColumns={mockModalityObsColumns}
            modalities={mockModalities}
            varCount={mockVarCount}
            activeEmbeddingKey={activeKey}
          />
        </div>

        {/* Demo buttons */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveKey("dinov2:X_umap");
              setColorSource(colorSourceObs("phase"));
            }}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-elevated"
          >
            Demo: dinov2 UMAP + rna:phase
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveKey("rna:X_umap");
              setColorSource(colorSourceObs("object_class"));
            }}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-elevated"
          >
            Demo: rna UMAP + dinov2:object_class
          </button>
          <button
            type="button"
            onClick={() => setColorSource(COLOR_NONE)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-elevated"
          >
            Reset
          </button>
        </div>
      </section>

      <Separator className="mb-10" />

      {/* ── Sketch 3: Multi-Panel Layout ───────────────────────────────── */}
      <section className="mb-10">
        <h2 className="mb-1 font-semibold text-lg">3. Multi-Panel Cross-Filter</h2>
        <p className="mb-4 text-xs text-text-muted">
          Lasso in one panel highlights the same cells in all other panels via shared __row_index__.
        </p>
        <MultiPanelPreview />
      </section>
    </div>
  );
}
