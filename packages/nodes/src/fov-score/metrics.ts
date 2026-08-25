/**
 * How well does the tuned score agree with the human labels?
 *
 * This is the scoreboard that turns curve tuning from guesswork into a loop: in the shrimPy
 * demo, enabling and narrowing three features moves pairwise accuracy from 0.533 (chance) to
 * 0.938, and top-N from 0.000 to 0.654. Without it you are dragging curves and hoping.
 *
 * Both metrics are read straight off the Qt viewer's status line, and its own numbers pin the
 * definitions: 147 FOVs labelled 26 good / 56 neutral / 65 bad gives
 * `26·56 + 26·65 + 56·65 = 6786`, which is exactly the "6786 good/neutral/bad pairs" it
 * reports. `top-26 acc 0.654` over "26 good" is 17/26, so N is the number of good labels.
 */

import type { Goodness } from "../fov-label/goodness";

/** Ordinal rank of a label. Unlabeled rows carry no order and are excluded from scoring. */
const RANK: Record<Goodness, number | null> = {
  good: 2,
  neutral: 1,
  bad: 0,
  unlabeled: null,
};

export interface ScoredFov {
  score: number;
  goodness: Goodness;
}

export interface ScoreMetrics {
  /**
   * Fraction of ordered label pairs the score puts in the right order. 0.5 is chance, 1.0 is
   * perfect agreement. Ties count as half, since a tie is neither right nor wrong and
   * scoring it as a loss would punish a curve for being flat where the labels disagree.
   */
  pairwiseAccuracy: number;
  /** Pairs compared — the denominator, worth showing so a tiny label set is visible as such. */
  pairs: number;
  /** Of the N best-scoring FOVs, the fraction that are actually labelled good (N = |good|). */
  topNAccuracy: number;
  /** N, i.e. how many FOVs are labelled good. */
  topN: number;
  /** How many of the top N are labelled good — the numerator, so "17 / 26" can be shown. */
  topNHits: number;
  /** Labelled rows available; the metrics are meaningless when this is near zero. */
  labeled: number;
}

const EMPTY: ScoreMetrics = {
  pairwiseAccuracy: 0,
  pairs: 0,
  topNAccuracy: 0,
  topN: 0,
  topNHits: 0,
  labeled: 0,
};

/**
 * Agreement between `score` and the labels.
 *
 * Only labelled rows count. Unlabeled rows are not "neutral" — treating absent ground truth
 * as a middling label would invent agreement the human never expressed.
 *
 * O(n²) over labelled rows. At 147 FOVs that is ~6.8k comparisons, i.e. free; a plate with
 * 10k labelled fields would want the rank-correlation formulation instead.
 * ponytail: quadratic pairwise loop, swap for a tie-aware Kendall tau if plates get large.
 */
export function scoreMetrics(rows: readonly ScoredFov[]): ScoreMetrics {
  const labeled = rows.filter((r) => RANK[r.goodness] != null);
  if (labeled.length < 2) return { ...EMPTY, labeled: labeled.length };

  let pairs = 0;
  let correct = 0;
  for (let i = 0; i < labeled.length; i++) {
    for (let j = i + 1; j < labeled.length; j++) {
      const a = labeled[i];
      const b = labeled[j];
      const ra = RANK[a.goodness]!;
      const rb = RANK[b.goodness]!;
      if (ra === rb) continue; // same label: no ordering to get right
      pairs += 1;
      const better = ra > rb ? a : b;
      const worse = ra > rb ? b : a;
      if (better.score > worse.score) correct += 1;
      else if (better.score === worse.score) correct += 0.5;
    }
  }

  const goods = labeled.filter((r) => r.goodness === "good");
  const topN = goods.length;
  let topNHits = 0;
  if (topN > 0) {
    // Rank over ALL rows, not just labelled ones: an unlabeled field outranking a good one
    // really does consume a slot in the top N, and hiding that would flatter the score.
    const ordered = rows.toSorted((a, b) => b.score - a.score);
    topNHits = ordered.slice(0, topN).filter((r) => r.goodness === "good").length;
  }

  return {
    pairwiseAccuracy: pairs === 0 ? 0 : correct / pairs,
    pairs,
    topNAccuracy: topN === 0 ? 0 : topNHits / topN,
    topN,
    topNHits,
    labeled: labeled.length,
  };
}
