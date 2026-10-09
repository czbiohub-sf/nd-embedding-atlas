import { describe, expect, test } from "bun:test";
import type { Goodness } from "../fov-label/goodness";
import { scoreMetrics, type ScoredFov } from "./metrics";

const fov = (score: number, goodness: Goodness): ScoredFov => ({ score, goodness });

/** The example dataset's real label distribution: 26 good / 56 neutral / 65 bad. */
const REAL_COUNTS = { good: 26, neutral: 56, bad: 65 } as const;

/** Score per label. Includes `unlabeled` so it satisfies the full Goodness union. */
type LabelScores = Record<Goodness, number>;
const ORDERED: LabelScores = { good: 3, neutral: 2, bad: 1, unlabeled: 0 };
const INVERTED: LabelScores = { good: 1, neutral: 2, bad: 3, unlabeled: 0 };

function realLabelSet(scoreFor: (goodness: Goodness, i: number) => number): ScoredFov[] {
  const rows: ScoredFov[] = [];
  for (const [goodness, n] of Object.entries(REAL_COUNTS) as [Goodness, number][]) {
    for (let i = 0; i < n; i++) rows.push(fov(scoreFor(goodness, i), goodness));
  }
  return rows;
}

describe("scoreMetrics", () => {
  test("pair count matches the Qt viewer's reported 6786 for this dataset", () => {
    // 26*56 + 26*65 + 56*65. Reproducing the tool's own number is what confirms the
    // definition is ordered cross-label pairs rather than all pairs (which would be 10731).
    const rows = realLabelSet((g) => ORDERED[g]);
    expect(scoreMetrics(rows).pairs).toBe(6786);
  });

  test("a perfectly ordering score reaches 1.0 on both metrics", () => {
    const rows = realLabelSet((g) => ORDERED[g]);
    const m = scoreMetrics(rows);
    expect(m.pairwiseAccuracy).toBe(1);
    expect(m.topNAccuracy).toBe(1);
    expect(m.topN).toBe(26);
    expect(m.topNHits).toBe(26);
  });

  test("an exactly inverted score reaches 0.0", () => {
    const rows = realLabelSet((g) => INVERTED[g]);
    const m = scoreMetrics(rows);
    expect(m.pairwiseAccuracy).toBe(0);
    expect(m.topNAccuracy).toBe(0);
  });

  test("a constant score is chance, not a loss", () => {
    // Every pair ties. Scoring ties as wrong would report 0.0 and make an untuned profile
    // look worse than an inverted one, which is misleading at the moment you start tuning.
    const rows = realLabelSet(() => 0.5);
    expect(scoreMetrics(rows).pairwiseAccuracy).toBe(0.5);
  });

  test("unlabeled rows are excluded from pairs but can still occupy the top N", () => {
    const rows = [
      fov(0.99, "unlabeled"), // outranks everything and takes a slot
      fov(0.9, "good"),
      fov(0.8, "good"),
      fov(0.1, "bad"),
    ];
    const m = scoreMetrics(rows);
    expect(m.labeled).toBe(3);
    expect(m.pairs).toBe(2); // good/bad x2; the unlabeled row contributes none
    expect(m.topN).toBe(2);
    // Only one good field lands in the top 2, because the unlabeled row is above it.
    expect(m.topNHits).toBe(1);
    expect(m.topNAccuracy).toBe(0.5);
  });

  test("same-label pairs are not compared", () => {
    const rows = [fov(0.1, "good"), fov(0.9, "good")];
    const m = scoreMetrics(rows);
    expect(m.pairs).toBe(0);
    expect(m.pairwiseAccuracy).toBe(0);
    expect(m.labeled).toBe(2);
  });

  test("neutral sits between good and bad", () => {
    // A score that separates good from bad but puts neutral on the wrong side is only
    // partly right, and the metric should say so rather than round to pass or fail.
    const rows = [fov(1, "good"), fov(0, "neutral"), fov(0.5, "bad")];
    const m = scoreMetrics(rows);
    expect(m.pairs).toBe(3);
    // good>neutral ✓, good>bad ✓, neutral>bad ✗
    expect(m.pairwiseAccuracy).toBeCloseTo(2 / 3, 12);
  });

  test("degenerate inputs return zeros rather than NaN", () => {
    for (const rows of [[], [fov(1, "good")], [fov(1, "unlabeled"), fov(2, "unlabeled")]]) {
      const m = scoreMetrics(rows);
      expect(Number.isFinite(m.pairwiseAccuracy)).toBe(true);
      expect(Number.isFinite(m.topNAccuracy)).toBe(true);
      expect(m.pairwiseAccuracy).toBe(0);
    }
  });

  test("reproduces the demo clip's 17/26 top-N shape", () => {
    // 26 good, of which 17 make the top 26 => 0.654, the number on screen at 17.5s.
    const rows: ScoredFov[] = [];
    for (let i = 0; i < 17; i++) rows.push(fov(100 - i, "good"));
    for (let i = 0; i < 9; i++) rows.push(fov(50 - i, "neutral")); // 9 interlopers rank above
    for (let i = 0; i < 9; i++) rows.push(fov(40 - i, "good")); // the remaining 9 good
    const m = scoreMetrics(rows);
    expect(m.topN).toBe(26);
    expect(m.topNHits).toBe(17);
    expect(m.topNAccuracy).toBeCloseTo(0.6538, 4);
  });
});
