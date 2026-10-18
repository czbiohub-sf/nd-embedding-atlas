/**
 * Columnar DuckDB writes: `appendColumns` fills `DuckDBDataChunk`s straight
 * from typed arrays and appends them. obs/var come from `read_zarr` in SQL;
 * this writes the rows that start in JS (annotations, dense gene columns).
 */

import { DuckDBDataChunk, DuckDBTypeId } from "@duckdb/node-api";
import type { DuckDBConnection, DuckDBVector } from "@duckdb/node-api";

type FixedWidthArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

/** One table column for `appendColumns`, in table column order. */
export type AppendColumn = { name: string; type: string } &
  /** Copied into DuckDB vectors as-is (BOOLEAN takes 0/1 bytes). A truthy `nulls[row]` is NULL. */
  (
    | { values: FixedWidthArray; nulls?: ArrayLike<unknown> }
    /** One value per row, for VARCHAR and anything without a fixed-width layout. null is NULL. */
    | { get: (row: number) => string | number | boolean | null }
  );

/** DuckDB's STANDARD_VECTOR_SIZE: the most rows one data chunk holds. */
const VECTOR_SIZE = 2048;

/**
 * ponytail: node-api 1.5.6 keeps a fixed-width vector's rows in a private
 * buffer (`items`, or `dataView` for BOOLEAN) that `flush()` copies into
 * DuckDB. Filling it with one `TypedArray.set` is a memcpy: 1.5× faster than
 * `setItem` per row on 1M rows. Re-check the field names on node-api upgrades.
 */
function vectorBuffer(vector: DuckDBVector): { set(values: ArrayLike<number | bigint>): void } {
  const raw = vector as unknown as { items?: FixedWidthArray; dataView?: DataView };
  if (raw.items) return raw.items;
  if (raw.dataView && vector.type.typeId === DuckDBTypeId.BOOLEAN) {
    return new Uint8Array(raw.dataView.buffer, raw.dataView.byteOffset, raw.dataView.byteLength);
  }
  throw new Error(`appendColumns: ${vector.type.toString()} has no fixed-width layout; pass \`get\``);
}

/**
 * Append `rows` rows to `table` (created first with `create`) from `columns`,
 * which cover every table column in order. One `DuckDBDataChunk` per 2048
 * rows: fixed-width values are copied in, `get` columns go through `setItem`.
 */
export async function appendColumns(
  conn: DuckDBConnection,
  table: string,
  rows: number,
  columns: readonly AppendColumn[],
  options: { create?: boolean } = {},
): Promise<void> {
  if (options.create) {
    const defs = columns.map((c) => `"${c.name.replace(/"/g, '""')}" ${c.type}`);
    await conn.run(`CREATE OR REPLACE TABLE ${table} (${defs.join(", ")})`);
  }
  const appender = await conn.createAppender(table);
  const types = columns.map((_, i) => appender.columnType(i));
  for (let r0 = 0; r0 < rows; r0 += VECTOR_SIZE) {
    const n = Math.min(VECTOR_SIZE, rows - r0);
    const chunk = DuckDBDataChunk.create(types, n);
    for (let c = 0; c < columns.length; c++) {
      const column = columns[c];
      const vector = chunk.getColumnVector(c);
      if ("get" in column) {
        for (let i = 0; i < n; i++) vector.setItem(i, column.get(r0 + i));
      } else {
        vectorBuffer(vector).set(column.values.subarray(r0, r0 + n));
        const nulls = column.nulls;
        if (nulls) for (let i = 0; i < n; i++) if (nulls[r0 + i]) vector.setItem(i, null);
      }
      vector.flush();
    }
    appender.appendDataChunk(chunk);
  }
  appender.closeSync();
}
