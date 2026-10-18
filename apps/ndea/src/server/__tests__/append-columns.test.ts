import { expect, test } from "bun:test";
import { appendColumns } from "../append-columns.ts";
import { openDuckDB } from "../zarr-extension.ts";

test("appendColumns writes typed arrays, NULL masks, and per-row values across chunk boundaries", async () => {
  const n = 5000; // > 2 data chunks of 2048 rows
  const { db, conn } = await openDuckDB();
  try {
    await appendColumns(
      conn,
      "t",
      n,
      [
        { name: "i", type: "INTEGER", values: Int32Array.from({ length: n }, (_, r) => r) },
        {
          name: "f",
          type: "FLOAT",
          values: Float32Array.from({ length: n }, (_, r) => r / 2),
          nulls: Uint8Array.from({ length: n }, (_, r) => (r % 1000 === 3 ? 1 : 0)),
        },
        { name: "b", type: "BOOLEAN", values: Uint8Array.from({ length: n }, (_, r) => r % 2) },
        { name: "big", type: "BIGINT", values: BigInt64Array.from({ length: n }, (_, r) => BigInt(r) * 10n) },
        { name: "s", type: "VARCHAR", get: (r) => (r % 7 === 0 ? null : `v${r}`) },
      ],
      { create: true },
    );
    const rows = (
      await conn.runAndReadAll("SELECT i, f, b, big, s FROM t WHERE i IN (0, 3, 2049, 4999) ORDER BY i")
    ).getRows();
    expect(rows).toEqual([
      [0, 0, false, 0n, null],
      [3, null, true, 30n, "v3"],
      [2049, 1024.5, true, 20490n, "v2049"],
      [4999, 2499.5, true, 49990n, "v4999"],
    ]);
  } finally {
    conn.closeSync();
    db.closeSync();
  }
});
