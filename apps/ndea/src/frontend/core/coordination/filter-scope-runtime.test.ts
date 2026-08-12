import { describe, expect, test } from "bun:test";
import { MosaicClient, type Selection } from "@uwdata/mosaic-core";
import { and, literal } from "@uwdata/mosaic-sql";
import { nodeInstanceId, rowIndex } from "@ndea/sdk";

import { FilterScopeRegistry } from "./filter-scope-runtime";

function selectionSql(selection: Selection, client: MosaicClient | null = null, noSkip = false): string | null {
  const predicate = selection.predicate(client, noSkip);
  if (predicate == null) return null;
  if (Array.isArray(predicate)) {
    if (predicate.length === 0) return null;
    return and(...predicate).toString();
  }
  return typeof predicate === "boolean" ? literal(predicate).toString() : predicate.toString();
}

function registry(query: (sql: string) => Promise<unknown> = async () => []): FilterScopeRegistry {
  return new FilterScopeRegistry({ coordinator: { query }, table: "dataset" });
}

describe("FilterScopeRegistry", () => {
  test("composes peer clauses while source clients skip only their own clause", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const b = filters.bind(nodeInstanceId("b"));
    const aClient = new MosaicClient(a.selection);
    const bClient = new MosaicClient(b.selection);
    a.associateClient(aClient);
    b.associateClient(bClient);
    a.setScope("A");
    b.setScope("A");

    a.publish("chart", "x > 1");
    b.publish("range", "y < 2");

    expect(selectionSql(a.selection, aClient, true)).toBe("y < 2");
    expect(selectionSql(b.selection, bClient, true)).toBe("x > 1");
    expect(selectionSql(a.selection)).toContain("x > 1");
    expect(selectionSql(a.selection)).toContain("y < 2");
    a.clear("chart");
    expect(selectionSql(b.selection)).toBe("y < 2");
  });

  test("keeps scopes isolated and moves clauses without changing selection identity", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const b = filters.bind(nodeInstanceId("b"));
    const c = filters.bind(nodeInstanceId("c"));
    const stable = a.selection;
    a.setScope("A");
    b.setScope("A");
    c.setScope("B");
    a.publish("chart", "a = 1");
    c.publish("range", "c = 1");

    expect(selectionSql(b.selection)).toBe("a = 1");
    expect(selectionSql(c.selection)).toBe("c = 1");
    a.setScope("B");

    expect(a.selection).toBe(stable);
    expect(selectionSql(b.selection)).toBeNull();
    expect(selectionSql(a.selection)).toContain("a = 1");
    expect(selectionSql(a.selection)).toContain("c = 1");
    expect(selectionSql(c.selection)).toContain("a = 1");
  });

  test("unassigned bindings query graph predicates only and publish nowhere", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const b = filters.bind(nodeInstanceId("b"));
    b.setScope("A");
    a.setGraphPredicate("quality > 0.5");
    a.publish("lasso", "x > 4");

    expect(selectionSql(a.selection)).toBe("quality > 0.5");
    expect(selectionSql(b.selection)).toBeNull();
    a.setScope("A");
    expect(selectionSql(b.selection)).toBe("x > 4");
  });

  test("graph predicates never self-skip beside an associated publisher clause", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const client = new MosaicClient(a.selection);
    a.associateClient(client);
    a.setGraphPredicate("quality > 0.5");
    a.publish("chart", "x > 1");
    a.setScope("A");

    expect(selectionSql(a.selection, client, true)).toBe("quality > 0.5");
    a.setScope("B");
    expect(selectionSql(a.selection, client, true)).toBe("quality > 0.5");
  });

  test("notifies monotonic resolved revisions and cleans empty scopes idempotently", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const revisions: number[] = [];
    a.subscribeResolved(({ revision }) => revisions.push(revision));
    a.setScope("A");
    a.publish("chart", "x = 1");
    a.publish("chart", "x = 2");
    a.clear("chart");

    expect(revisions).toEqual(revisions.toSorted((x, y) => x - y));
    expect(new Set(revisions).size).toBe(revisions.length);
    a.dispose();
    a.dispose();
    expect(filters.bindingCount).toBe(0);
    expect(filters.scopeCount).toBe(0);
  });

  test("does not revise an unchanged graph predicate", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    a.setGraphPredicate(null);
    expect(a.getResolved().revision).toBe(1);
    a.setGraphPredicate(null);
    expect(a.getResolved().revision).toBe(1);

    a.setGraphPredicate("x > 1");
    const revision = a.getResolved().revision;

    a.setGraphPredicate("x > 1");

    expect(a.getResolved().revision).toBe(revision);
  });

  test("disposing one publisher removes its mirrored clause and listeners", () => {
    const filters = registry();
    const a = filters.bind(nodeInstanceId("a"));
    const b = filters.bind(nodeInstanceId("b"));
    a.setScope("A");
    b.setScope("A");
    a.publish("chart", "x = 1");
    expect(selectionSql(b.selection)).toBe("x = 1");

    a.dispose();
    expect(selectionSql(b.selection)).toBeNull();
    expect(filters.bindingCount).toBe(1);
    expect(filters.scopeCount).toBe(1);
    b.dispose();
    expect(filters.scopeCount).toBe(0);
  });

  test("materializes observed rows and rejects stale or aborted completion", async () => {
    let query = Promise.withResolvers<unknown>();
    const filters = registry(() => query.promise);
    const a = filters.bind(nodeInstanceId("a"));
    a.setGraphPredicate("x > 1");
    const observedRevision = a.getResolved().revision;
    const current = a.materializeRowIds();
    query.resolve([{ __row_index__: rowIndex(2) }, { __row_index__: rowIndex(5) }]);
    expect(await current).toEqual({ rowIds: [rowIndex(2), rowIndex(5)], revision: observedRevision });

    query = Promise.withResolvers<unknown>();
    const pending = a.materializeRowIds();
    a.setGraphPredicate("x > 2");
    query.resolve([{ __row_index__: rowIndex(3) }]);
    await expect(pending).rejects.toThrow("filter changed");

    query = Promise.withResolvers<unknown>();
    const controller = new AbortController();
    const aborted = a.materializeRowIds(controller.signal);
    controller.abort();
    await expect(aborted).rejects.toHaveProperty("name", "AbortError");
  });

  test("materializes retained facet row identities instead of mutable temp-table SQL", async () => {
    let sql = "";
    const filters = registry(async (query) => {
      sql = query;
      return [];
    });
    const a = filters.bind(nodeInstanceId("a"));
    const b = filters.bind(nodeInstanceId("b"));
    a.setScope("A");
    b.setScope("A");
    a.publish("lasso", "__row_index__ IN (SELECT row_index FROM sel_a) /* tok=4 */", [rowIndex(2), rowIndex(5)]);

    await b.materializeRowIds();
    expect(sql).toContain("__row_index__ IN (2, 5)");
    expect(sql).not.toContain("sel_a");
  });

  test("rejects materialization completed after an unscoped binding is disposed", async () => {
    const query = Promise.withResolvers<unknown>();
    const filters = registry(() => query.promise);
    const a = filters.bind(nodeInstanceId("a"));
    const pending = a.materializeRowIds();
    a.dispose();
    query.resolve([{ __row_index__: rowIndex(1) }]);
    await expect(pending).rejects.toThrow("filter changed");
  });
});
