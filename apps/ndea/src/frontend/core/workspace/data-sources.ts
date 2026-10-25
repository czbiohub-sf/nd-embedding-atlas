/**
 * Named data sources: the dashboard's data flow. Each source narrows another
 * (`from`, or every observation when omitted) by a typed clause (`where`, which
 * may be `{op:"inSet"}` for a saved set) and/or a SQL predicate (`sql`). A
 * source compiles to one predicate by walking its `from` chain. Pure, so the
 * server evaluates exactly what the browser renders.
 */

import { FilterClauseSchema } from "@ndea/protocol";
import { z } from "zod";

import { filterClausesSql, filterScopeClauses } from "../coordination/types";
import { filterClauseSql } from "@ndea/components/filter";
import { elementData, elementScope, findElement } from "./dashboard";
import type { WorkspaceDocument } from "./types";

export const DATA_SOURCE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const dataSourceSchema = z
  .object({
    from: z.string().optional().describe("source to narrow; omit to start from every observation"),
    where: FilterClauseSchema.optional().describe("typed clause, e.g. {op:'eq', column, value}"),
    sql: z.string().min(1).optional().describe("SQL predicate over observation columns"),
  })
  .strict();

export const dataSchema = z.record(
  z.string().regex(DATA_SOURCE_NAME, "data source names start with a letter and use letters, digits, _ and -"),
  dataSourceSchema,
);

export type DataSources = z.infer<typeof dataSchema>;

/** Unknown `from` references and cycles, as `[path, message]` pairs. */
export function dataIssues(data: DataSources): [string[], string][] {
  const issues: [string[], string][] = [];
  for (const [name, source] of Object.entries(data)) {
    if (source.from !== undefined && !data[source.from]) {
      issues.push([["data", name, "from"], `unknown data source "${source.from}"`]);
    }
  }
  for (const name of Object.keys(data)) {
    const seen = new Set<string>();
    for (let at: string | undefined = name; at !== undefined; at = data[at]?.from) {
      if (seen.has(at)) {
        issues.push([["data", name, "from"], `data source "${name}" depends on itself`]);
        break;
      }
      seen.add(at);
    }
  }
  return issues;
}

function and(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((part): part is string => part !== null);
  if (present.length === 0) return null;
  return present.length === 1 ? present[0] : present.map((part) => `(${part})`).join(" AND ");
}

/** The predicate a source selects, or null for every observation. Assumes `dataIssues` passed. */
export function dataSourceSql(data: DataSources, name: string | undefined): string | null {
  const parts: (string | null)[] = [];
  for (let at = name; at !== undefined; at = data[at]?.from) {
    const source = data[at];
    if (!source) break;
    parts.push(source.where ? filterClauseSql(source.where) : null, source.sql ?? null);
  }
  return and(parts.toReversed());
}

/**
 * What one dashboard element (of any layout) shows: its data source AND every
 * other source's clauses in its filter scope (never its own, keyed by element
 * id). Null for every observation, or when the element does not exist.
 */
export function elementPredicate(document: WorkspaceDocument, elementId: string): string | null {
  const element = findElement(document, elementId);
  if (!element) return null;
  const cell = document.state.filter?.[elementScope(element, "filter") ?? ""];
  return and([
    dataSourceSql(document.data, elementData(element)),
    filterClausesSql(filterScopeClauses(cell, elementId)),
  ]);
}
