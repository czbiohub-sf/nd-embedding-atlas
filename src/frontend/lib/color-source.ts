/**
 * ColorSource — discriminated union replacing colorByColumn: string | null.
 *
 * Three semantic variants:
 *  - "none"  → no coloring
 *  - "obs"   → a column from obs_base (cell metadata)
 *  - "var"   → a materialized var/expression column (__var_{name}_{layer}__)
 *
 * The "column" field on obs and var variants is always the DuckDB column
 * name — safe to pass directly to SQL without encoding/decoding.
 */

export type ColorSource =
  | { readonly kind: "none" }
  | { readonly kind: "obs"; readonly column: string }
  | {
      readonly kind: "var";
      readonly varName: string;
      readonly layer: string;
      readonly column: string;
    };

export const COLOR_NONE = { kind: "none" } as const satisfies ColorSource;

export function colorSourceObs(column: string): ColorSource & { kind: "obs" } {
  return { kind: "obs", column };
}

export function colorSourceVar(varName: string, layer: string): ColorSource & { kind: "var" } {
  const column = `__var_${varName.replace(/[^a-zA-Z0-9]/g, "_")}_${layer.replace(/[^a-zA-Z0-9]/g, "_")}__`;
  return { kind: "var", varName, layer, column };
}

// ── Codec: legacy string ↔ ColorSource ─────────────────────────────────────

const VAR_RE = /^__var_(.+)_([^_]+)__$/;

export function colorSourceFromString(col: string | null): ColorSource {
  if (!col) return COLOR_NONE;
  const m = col.match(VAR_RE);
  if (m) return { kind: "var", varName: m[1], layer: m[2], column: col };
  return { kind: "obs", column: col };
}

export function colorSourceToString(src: ColorSource): string | null {
  if (src.kind === "none") return null;
  return src.column;
}

// ── Type guards ─────────────────────────────────────────────────────────────

export function isObsSource(src: ColorSource): src is ColorSource & { kind: "obs" } {
  return src.kind === "obs";
}

export function isVarSource(src: ColorSource): src is ColorSource & { kind: "var" } {
  return src.kind === "var";
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** Human-readable label for the trigger pill and colorbar. */
export function colorSourceLabel(src: ColorSource): string {
  if (src.kind === "none") return "none";
  if (src.kind === "var") return src.varName;
  return src.column;
}

/** For the continuous legend — shows layer name for var, column name for obs. */
export function colorSourceLegendLabel(src: ColorSource): string {
  if (src.kind === "none") return "";
  if (src.kind === "var") return src.layer;
  return src.column;
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled ColorSource kind: ${JSON.stringify(x)}`);
}
