/**
 * A plate/well/field tree beside the grid, for navigating and selecting by well.
 *
 * Composed from `Collapsible` (Base UI, via `@ndea/ui`) following shadcn's own file-tree
 * pattern, rather than a tree library. The reason is not the dependency count: a tree library
 * ships its own selection state, and this rail is a second way to drive the selection the grid
 * already owns. Two models mean an adapter, and an adapter that maps path strings back to row
 * indices loses the one thing `selection.ts` exists to protect — the anchor a shift-range
 * extends from, in VISUAL order. So the rail holds no selection of its own; it calls
 * `applyClick`/`applyGroupClick` exactly like a cell click does, and reads `selected` back to
 * render its own highlight. One Set, one anchor, one order.
 *
 * Wells are collapsed by default. That is what stands in for virtualization: a 96-well plate at
 * 49 fields per well is ~4,700 leaves, and rendering them all is both slow and unreadable.
 * Collapsed, the rail is 96 rows and expanding one well adds 49.
 *
 * Plate layout only. A tree is inherently positional, so pairing it with the score-ranked
 * layout would show a hierarchy that contradicts the order on screen.
 */

import { useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ndea/ui/components/collapsible";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GOODNESS_SWATCH, type Goodness } from "./goodness";
import type { PlateWell } from "./plate-grid";
import type { ClickModifiers } from "./selection";
import type { PlateFov } from "./usePlateFovs";

export interface PlateTreeProps {
  /** Wells in plate order, from `decodePlateGrid`. */
  wells: readonly PlateWell[];
  byFovName: ReadonlyMap<string, PlateFov>;
  /** Fields in the order they appear on screen, so the rail can order a well the same way. */
  order: readonly number[];
  selected: ReadonlySet<number>;
  /** One field clicked, with modifiers — same contract as a grid cell. */
  onSelectField: (rowIndex: number, modifiers: ClickModifiers) => void;
  /** A whole well clicked; `rowIndices` is every field under it. */
  onSelectWell: (rowIndices: number[], modifiers: ClickModifiers) => void;
  onCollapse: () => void;
}

const modifiersOf = (event: React.MouseEvent): ClickModifiers => ({
  shift: event.shiftKey,
  toggle: event.metaKey || event.ctrlKey,
});

/** Field id only — the well is already the parent row, so repeating it is noise. */
function fieldLabel(fovName: string): string {
  const cut = fovName.lastIndexOf("/");
  return cut === -1 ? fovName : fovName.slice(cut + 1);
}

export function PlateTree({
  wells,
  byFovName,
  order,
  selected,
  onSelectField,
  onSelectWell,
  onCollapse,
}: PlateTreeProps) {
  /**
   * Well rows with their fields already in visual order and their label tally.
   *
   * The tally is why a plate-aware rail beats a generic file tree: "B/5 — 31 fields, 4 bad" is
   * the summary an operator actually scans for, and no path-based tree can know it.
   */
  const rows = useMemo(
    () =>
      wells
        .map((well) => {
          const fields = order
            .map((rowIndex) => well.cells.find((cell) => byFovName.get(cell.fovName)?.rowIndex === rowIndex))
            .filter((cell): cell is NonNullable<typeof cell> => cell != null)
            .map((cell) => byFovName.get(cell.fovName))
            .filter((fov): fov is PlateFov => fov != null);
          const counts: Record<Goodness, number> = { good: 0, neutral: 0, bad: 0, unlabeled: 0 };
          for (const fov of fields) counts[fov.goodness] += 1;
          return { well: well.well, fields, counts, rowIndices: fields.map((fov) => fov.rowIndex) };
        })
        .filter((row) => row.fields.length > 0),
    [wells, byFovName, order],
  );

  return (
    <div className="flex min-h-0 w-56 flex-none flex-col border-border/40 border-r">
      <div className="flex flex-none items-center px-2 pt-1.5 pb-1 font-mono text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {rows.length} well{rows.length === 1 ? "" : "s"} · {selected.size} selected
        </span>
        <button
          type="button"
          aria-label="Collapse well list"
          title="Collapse well list"
          onClick={onCollapse}
          className="grid size-5 flex-none place-items-center rounded hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-1">
        {rows.map((row) => (
          <li key={row.well}>
            <Collapsible>
              <div className="flex items-center gap-0.5">
                <CollapsibleTrigger
                  aria-label={`expand ${row.well}`}
                  className="flex size-4 flex-none items-center justify-center rounded text-muted-foreground hover:bg-muted data-[panel-open]:rotate-90"
                >
                  <ChevronRight className="size-3" />
                </CollapsibleTrigger>
                <button
                  type="button"
                  // Selects the well; expanding is the chevron's job. Keeping them apart means
                  // labelling a whole dud well never forces you to look at its 49 fields.
                  onClick={(event) => onSelectWell(row.rowIndices, modifiersOf(event))}
                  title={`${row.well}: ${row.fields.length} fields · ${row.counts.good} good, ${row.counts.neutral} neutral, ${row.counts.bad} bad, ${row.counts.unlabeled} unlabelled`}
                  className={`flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-2xs hover:bg-muted ${
                    row.rowIndices.every((id) => selected.has(id)) ? "bg-muted text-foreground" : "text-foreground/80"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{row.well}</span>
                  {/* A stacked bar per well: whole-well effects are visible without expanding. */}
                  <span className="flex h-2 w-10 flex-none overflow-hidden rounded-sm" aria-hidden="true">
                    {(["good", "neutral", "bad", "unlabeled"] as const).map((value) =>
                      row.counts[value] === 0 ? null : (
                        <span key={value} className={GOODNESS_SWATCH[value]} style={{ flexGrow: row.counts[value] }} />
                      ),
                    )}
                  </span>
                  <span className="flex-none text-muted-foreground/60">{row.fields.length}</span>
                </button>
              </div>

              <CollapsibleContent>
                <ul className="ml-4 border-border/40 border-l pl-1">
                  {row.fields.map((fov) => (
                    <li key={fov.rowIndex}>
                      <button
                        type="button"
                        onClick={(event) => onSelectField(fov.rowIndex, modifiersOf(event))}
                        aria-pressed={selected.has(fov.rowIndex)}
                        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left font-mono text-2xs hover:bg-muted ${
                          selected.has(fov.rowIndex) ? "bg-muted text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`size-1.5 flex-none rounded-full ${GOODNESS_SWATCH[fov.goodness]}`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{fieldLabel(fov.fovName)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ))}
      </ul>
    </div>
  );
}
