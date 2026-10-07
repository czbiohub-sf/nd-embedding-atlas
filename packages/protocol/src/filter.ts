/**
 * Typed observation filter: the JSON form of a closed subset of Mosaic's
 * predicate builders. One clause compiles to the same SQL for the browser
 * graph and for `POST /api/filter`, so both select identical observations.
 * Raw SQL never appears in a clause.
 */

import { z } from "zod";

export type FilterValue = string | number | boolean;

export type FilterClause =
  | { op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; column: string; value: FilterValue }
  | { op: "between"; column: string; range: [FilterValue, FilterValue] }
  | { op: "in"; column: string; values: FilterValue[] }
  | { op: "isNull" | "isNotNull"; column: string }
  | { op: "and" | "or"; clauses: FilterClause[] }
  | { op: "not"; clause: FilterClause }
  | { op: "inSet"; set: string };

const FilterValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const ColumnSchema = z.string().min(1);

/** Content address of a named observation set (see POST /api/sets). */
export const ObservationSetIdSchema = z.string().regex(/^[0-9a-f]{16}$/, "Expected a 16-hex observation set id");

/** Server table holding `(set_id, __row_index__)` for every loaded observation set. */
export const OBSERVATION_SET_TABLE = "ndea_obs_sets";

export const FilterClauseSchema: z.ZodType<FilterClause> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.enum(["eq", "neq", "lt", "lte", "gt", "gte"]),
      column: ColumnSchema,
      value: FilterValueSchema,
    }),
    z.object({
      op: z.literal("between"),
      column: ColumnSchema,
      range: z.tuple([FilterValueSchema, FilterValueSchema]),
    }),
    z.object({ op: z.literal("in"), column: ColumnSchema, values: z.array(FilterValueSchema).min(1) }),
    z.object({ op: z.enum(["isNull", "isNotNull"]), column: ColumnSchema }),
    z.object({ op: z.enum(["and", "or"]), clauses: z.array(FilterClauseSchema).min(1) }),
    z.object({ op: z.literal("not"), clause: FilterClauseSchema }),
    z.object({ op: z.literal("inSet"), set: ObservationSetIdSchema }),
  ]),
);

/** POST /api/filter body. `where: null` selects every observation. */
export const FilterRequestSchema = z.object({
  where: FilterClauseSchema.nullable(),
  limit: z.number().int().nonnegative().max(1_000_000).default(1000),
});
export type FilterRequest = z.input<typeof FilterRequestSchema>;

/**
 * One matched observation. `(datasetKey, obsName)` is the durable identity;
 * `rowIndex` is the session handle the other `/api` routes accept.
 */
export const FilterRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  datasetKey: z.string(),
  obsName: z.string(),
});
export type FilterRow = z.infer<typeof FilterRowSchema>;

/** POST /api/filter response. Rows are ordered by `rowIndex`. */
export const FilterResponseSchema = z.object({
  /** Compiled WHERE fragment; null when `where` was null. */
  sql: z.string().nullable(),
  count: z.number().int().nonnegative(),
  rows: z.array(FilterRowSchema),
  truncated: z.boolean(),
});
export type FilterResponse = z.infer<typeof FilterResponseSchema>;

/**
 * POST /api/sets: persist the observations behind a selection as a named,
 * content-addressed set. Identity is (dataset, obs name), so a set survives
 * re-ingest; `rowIndices` is only how the client names them.
 */
export const ObservationSetCreateBodySchema = z.object({
  rowIndices: z.array(z.number().int().nonnegative()).min(1).max(5_000_000),
});
export type ObservationSetCreateBody = z.infer<typeof ObservationSetCreateBodySchema>;

/** POST /api/sets response; reference the set as `{ op: "inSet", set }`. */
export const ObservationSetSchema = z.object({ set: ObservationSetIdSchema, count: z.number().int().nonnegative() });
export type ObservationSet = z.infer<typeof ObservationSetSchema>;
