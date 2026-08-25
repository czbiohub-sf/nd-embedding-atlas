/**
 * The `goodness` label: shrimPy's per-FOV ground truth, and the only thing in a feature
 * matrix a human writes by hand.
 *
 * Encoded numerically on disk (good=1, neutral=0, bad=-1, missing=unlabeled) because the
 * offline predictor thresholds it directly (`y = goodness >= 0`). It is NOT the model's
 * output — that is `predicted_goodness` — and it is not derived from the score function,
 * though a tuned score can propose values for a human to correct.
 */

/** The imported label column, as written by shrimPy's offline feature viewer. Read-only here. */
export const GOODNESS_COLUMN = "goodness";

/**
 * Where labels made in this dashboard go.
 *
 * NOT `goodness` itself: annotation columns are materialised as separate `ann_{name}`
 * tables LEFT JOINed into the `dataset` view, so writing `goodness` would create an
 * `ann_goodness` shadowing the obs column of the same name. Writing beside it also keeps
 * provenance — imported ground truth stays distinguishable from edits made here, and
 * `commitObsColumns` can fold them back into the store deliberately.
 */
export const GOODNESS_USER_COLUMN = "goodness_user";

export type Goodness = "good" | "neutral" | "bad" | "unlabeled";

/** Display order, and the order a click cycles through. */
export const GOODNESS_ORDER: readonly Goodness[] = ["good", "neutral", "bad", "unlabeled"];

const CODES: Record<Exclude<Goodness, "unlabeled">, number> = { good: 1, neutral: 0, bad: -1 };

/**
 * Outline colours, matching the Qt feature viewer's `goodness_color` so a plate reads the
 * same in both tools. These are the semantic tokens, not raw hex, so the palette follows
 * the theme.
 */
export const GOODNESS_OUTLINE: Record<Goodness, string> = {
  good: "border-success",
  neutral: "border-warning",
  bad: "border-destructive",
  unlabeled: "border-border/40",
};

/** Fill colours for well tally bars and field dots, matching the outline semantics. */
export const GOODNESS_SWATCH: Record<Goodness, string> = {
  good: "bg-success",
  neutral: "bg-warning",
  bad: "bg-destructive",
  unlabeled: "bg-muted",
};

/** Text colours, for legends and counts. */
export const GOODNESS_TEXT: Record<Goodness, string> = {
  good: "text-success",
  neutral: "text-warning",
  bad: "text-destructive",
  unlabeled: "text-muted-foreground",
};

/** Reverse of GOODNESS_KEYS, for showing the shortcut on the control that performs it. */
export const GOODNESS_KEY_FOR: Record<Goodness, string> = {
  good: "1",
  neutral: "2",
  bad: "3",
  unlabeled: "0",
};

/** Numeric code written back to the feature matrix; null clears the label. */
export function goodnessCode(value: Goodness): number | null {
  return value === "unlabeled" ? null : CODES[value];
}

/** Read a stored value, tolerating the string forms DuckDB may hand back. */
export function parseGoodness(raw: unknown): Goodness {
  if (raw == null || raw === "") return "unlabeled";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "unlabeled";
  if (n > 0) return "good";
  if (n < 0) return "bad";
  return "neutral";
}

/**
 * Next label when a cell is clicked. Starts at `good` from unlabeled: the operator is
 * hunting for fields worth imaging, so the first click marks a keeper.
 */
export function cycleGoodness(current: Goodness): Goodness {
  const next = (GOODNESS_ORDER.indexOf(current) + 1) % GOODNESS_ORDER.length;
  return GOODNESS_ORDER[next];
}

/** Keyboard shortcuts, in the Qt viewer's panel order (Good / Neutral / Bad). */
export const GOODNESS_KEYS: Record<string, Goodness> = {
  "1": "good",
  "2": "neutral",
  "3": "bad",
  "0": "unlabeled",
};
