/**
 * Plate geometry for FOV-level rows: turn `fov_name` values into a per-well grid.
 *
 * Field paths from the offline shrimPy stores are grid codes, `RRRCCC`, zero-padded:
 * `B/3/000000` … `B/3/006006` is a 7×7 grid of fields within well B/3 (9×9 for
 * datasets with more fields, e.g. caax_h2b's `008008`). Decoding them recovers where
 * each FOV physically sat, which is what makes whole-well effects legible — a plate
 * where one well is uniformly bad reads instantly as a grid and not at all as a list.
 *
 * Not every producer uses grid codes: the online pre-scan stores number fields densely
 * (`0000`…`0048`) in acquisition order. `decodePlateGrid` detects that and falls back to
 * a row-major fill, so the layout degrades to "some grid" rather than to nonsense.
 */

/** One FOV placed in its well's grid. */
export interface PlateCell {
  /** Original `fov_name`, e.g. "B/3/000000". */
  readonly fovName: string;
  /** Well path, e.g. "B/3". */
  readonly well: string;
  readonly row: number;
  readonly col: number;
}

export interface PlateWell {
  readonly well: string;
  readonly rows: number;
  readonly cols: number;
  readonly cells: readonly PlateCell[];
}

export interface PlateGrid {
  readonly wells: readonly PlateWell[];
  /** How positions were derived; "sequential" means the field ids were not grid codes. */
  readonly layout: "grid-code" | "sequential";
}

/** Split "B/3/000000" into well ("B/3") and field ("000000"). */
export function splitFovName(fovName: string): { well: string; field: string } | null {
  const cut = fovName.lastIndexOf("/");
  if (cut <= 0 || cut === fovName.length - 1) return null;
  return { well: fovName.slice(0, cut), field: fovName.slice(cut + 1) };
}

/**
 * A field id is a grid code when it decodes to `RRRCCC` — i.e. the low three digits are
 * a column index. Dense sequential ids (0, 1, 2, …) all decode to row 0, so a set whose
 * decoded rows are entirely zero while there are more fields than plausible columns is
 * sequential, not grid-coded.
 */
export function looksGridCoded(fields: readonly string[]): boolean {
  if (fields.length === 0) return false;
  const codes = fields.map((f) => Number(f));
  if (codes.some((c) => !Number.isInteger(c) || c < 0)) return false;
  const rows = new Set(codes.map((c) => Math.floor(c / 1000)));
  // Grid codes put fields on several rows; dense ids never leave row 0 until the 1000th.
  return rows.size > 1;
}

function packSequential(fields: readonly string[]): Map<string, { row: number; col: number }> {
  // Square-ish row-major fill: the acquisition order is all the information there is.
  const cols = Math.max(1, Math.ceil(Math.sqrt(fields.length)));
  const placed = new Map<string, { row: number; col: number }>();
  fields.forEach((field, i) => placed.set(field, { row: Math.floor(i / cols), col: i % cols }));
  return placed;
}

/**
 * Group `fov_name` values by well and place each within its well's grid.
 *
 * Wells are ordered by name, cells row-major. Grid extents come from the data (the
 * largest index present, +1) rather than any assumed plate format, so a 7×7 and a 9×9
 * dataset both lay out correctly and a partial acquisition keeps its holes.
 */
export function decodePlateGrid(fovNames: readonly string[]): PlateGrid {
  const byWell = new Map<string, string[]>();
  for (const fovName of fovNames) {
    const split = splitFovName(fovName);
    if (!split) continue;
    const fields = byWell.get(split.well);
    if (fields) fields.push(split.field);
    else byWell.set(split.well, [split.field]);
  }

  const allFields = [...byWell.values()].flat();
  const gridCoded = looksGridCoded(allFields);

  const wells: PlateWell[] = [];
  for (const well of [...byWell.keys()].toSorted()) {
    const fields = byWell.get(well)!.toSorted();
    const placed = gridCoded
      ? new Map(fields.map((f) => [f, { row: Math.floor(Number(f) / 1000), col: Number(f) % 1000 }]))
      : packSequential(fields);

    let rows = 0;
    let cols = 0;
    const cells: PlateCell[] = [];
    for (const field of fields) {
      const at = placed.get(field)!;
      rows = Math.max(rows, at.row + 1);
      cols = Math.max(cols, at.col + 1);
      cells.push({ fovName: `${well}/${field}`, well, row: at.row, col: at.col });
    }
    wells.push({ well, rows, cols, cells: cells.toSorted((a, b) => a.row - b.row || a.col - b.col) });
  }

  return { wells, layout: gridCoded ? "grid-code" : "sequential" };
}
