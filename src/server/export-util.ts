/**
 * Shared export helpers — one home for the export directory + filename
 * sanitiser that the export / collections / annotations paths all need.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Directory new exports are written to: `$NDEA_EXPORT_DIR`, else
 * `~/ndea-exports/`. Resolved (not created) — callers `mkdir -p` as needed.
 */
export function exportDir(): string {
  const env = Bun.env["NDEA_EXPORT_DIR"];
  if (env && env.trim().length > 0) return resolve(env);
  return resolve(join(homedir(), "ndea-exports"));
}

/** Sanitise a user filename into a safe `<name>.<ext>` basename. */
export function sanitiseFilename(name: string, ext: "parquet" | "csv"): string {
  const trimmed = name.trim().replace(/\.(parquet|csv)$/i, "");
  const safe = trimmed.replace(/[^\w.-]+/g, "_").slice(0, 128);
  return `${safe.length > 0 ? safe : "export"}.${ext}`;
}
