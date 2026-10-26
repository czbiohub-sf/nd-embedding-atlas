/** GET /api/columns: the column catalog clients list and type columns from. */

import { columnType, type CatalogColumn } from "@ndea/protocol";
import type { DatasetQuerySession } from "../store.ts";

/** `store.columns()` in VIEW order, without internal `__*` columns (row identity, encodings, var columns). */
export function handleColumns(store: DatasetQuerySession): Response {
  const columns: CatalogColumn[] = [];
  for (const [name, { sqlType, kind }] of store.columns()) {
    if (!name.startsWith("__")) columns.push({ name, type: columnType(sqlType), sqlType, kind });
  }
  return Response.json(columns);
}
