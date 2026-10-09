import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";
import type { Aggregation, FeatureSpec } from "./desirability";

export type FovScoreCapabilities = "data-read" | "focus-coordination";

/**
 * The node's config IS the shrimPy model block.
 *
 * One object drives the curve overlays, the live score, the accuracy readout and the exported
 * yaml. Keeping them as one thing is the point: if the exported file were assembled separately
 * from what the plots draw, a tuned config could stop matching what the operator saw, and the
 * acquisition would image fields nobody chose.
 */
export interface FovScoreConfig {
  /** Feature name → curve, weight and enabled flag. Persisted, so tuning survives a reload. */
  features: Record<string, FeatureSpec>;
  aggregation: Aggregation | null;
  /** How many top-ranked FOVs the acquisition keeps. shrimPy requires it. */
  topFov: number | null;
  /** Histogram resolution for the small multiples. */
  bins: number | null;
  /**
   * Plot edge in CSS px — the node's zoom. Fixed rather than fractional for the same reason
   * the plate grid is: fifteen `1fr` tracks in one tile collapse to unreadable slivers.
   */
  plotPx: number | null;
  /** Which bottom pane is open: the parameter table, the yaml preview, or neither. */
  pane: "table" | "yaml" | "none" | null;
}

export type FovScoreBodyProps = SharedNodeBodyProps<FovScoreConfig, FovScoreCapabilities>;
