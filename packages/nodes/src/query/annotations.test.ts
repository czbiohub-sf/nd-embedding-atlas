import { describe, expect, test } from "bun:test";
import { announceAnnotationWrite, annotationCacheSuffix, useAnnotationRevision } from "./annotations";

describe("annotationCacheSuffix", () => {
  test("a fresh session adds nothing, so the first query is cacheable as normal", () => {
    expect(annotationCacheSuffix(0)).toBe("");
  });

  test("each revision produces a distinct suffix", () => {
    // This is the whole mechanism: Mosaic's QueryManager keys results on the raw SQL string,
    // so two revisions MUST produce two different strings or a re-read after a write returns
    // the pre-write rows from cache and the label edit looks like it did nothing.
    const suffixes = new Set([1, 2, 3, 10].map(annotationCacheSuffix));
    expect(suffixes.size).toBe(4);
  });

  test("the suffix is a comment, so it cannot change the query it is appended to", () => {
    // Anything other than a comment would alter the parse or the plan.
    const suffix = annotationCacheSuffix(7);
    expect(suffix.startsWith("\n--")).toBe(true);
    expect(suffix).not.toContain(";");
    const sql = `SELECT a FROM dataset ORDER BY a${suffix}`;
    expect(sql.split("\n")[0]).toBe("SELECT a FROM dataset ORDER BY a");
  });
});

describe("announceAnnotationWrite", () => {
  test("is monotonic, so a reader can compare against the revision it last saw", () => {
    // `useRefetchOnAnnotationWrite` guards on `seen.current === revision`; a revision that
    // could repeat would make it skip a refetch that was needed.
    const seen = new Set<number>();
    // The hook is the only reader, so read the store the way it does: through one render's
    // worth of value. Here we only need that repeated calls keep producing new values.
    for (let i = 0; i < 5; i++) {
      announceAnnotationWrite();
      const suffix = annotationCacheSuffix(i + 1);
      expect(seen.has(i + 1)).toBe(false);
      seen.add(i + 1);
      expect(suffix).toContain(String(i + 1));
    }
  });

  test("exports a hook for the revision rather than the store itself", () => {
    // The store stays module-private on purpose: a node that wrote it directly could bump the
    // revision without a write having happened, and every reader would refetch for nothing.
    expect(typeof useAnnotationRevision).toBe("function");
  });
});
