export type ColorMode = "categorical" | "continuous";

/**
 * Determine default color mode for a column based on its dtype.
 * Numeric columns default to continuous; string/boolean default to categorical.
 * Returns `canToggle: true` for numeric columns so the UI can show a toggle.
 */
export function resolveColorMode(
  columnName: string | null,
  columnTypes: Map<string, string> | null,
  userOverride?: ColorMode,
): { mode: ColorMode; canToggle: boolean } {
  if (!columnName || !columnTypes) return { mode: "categorical", canToggle: false };
  const dtype = columnTypes.get(columnName);
  const defaultMode: ColorMode = dtype === "number" ? "continuous" : "categorical";
  return {
    mode: userOverride ?? defaultMode,
    canToggle: dtype === "number",
  };
}
