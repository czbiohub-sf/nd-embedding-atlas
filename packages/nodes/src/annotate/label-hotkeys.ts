/**
 * Label vocabulary → keyboard bindings.
 *
 * Split out from `use-annotation-writer` on purpose: that module is the WRITE
 * path and stays free of presentation concerns, while this is a labeling-UI
 * decision. It is shared rather than duplicated so the Annotate table and the
 * Carousel bind the same keys to the same vocabulary — muscle memory has to
 * survive switching surfaces.
 */

/** One-key hotkey per label: first unused letter, else its 1-based digit. */
export function hotkeysFor(labels: readonly string[]): string[] {
  const used = new Set<string>();
  return labels.map((l, i) => {
    const c = l.trim()[0]?.toLowerCase();
    if (c && /[a-z]/.test(c) && !used.has(c)) {
      used.add(c);
      return c;
    }
    return String(i + 1);
  });
}
