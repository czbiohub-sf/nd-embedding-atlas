/**
 * Auto-generate default chart panel specs from column types.
 */

import type { ColumnType } from "../hooks/useColumnTypes";
import type { ChartPanelEntry, ChartSpec, Metadata } from "../types";

/** Columns to skip when generating chart panels. */
const SKIP_COLUMNS = new Set(["__row_index__"]);

/** Prefixes that indicate embedding columns (created by the viewer). */
const EMBEDDING_PREFIXES = ["__ev_"];

/** Prefixes that indicate embedding coordinate columns. */
const COORD_PATTERNS = [/^pca_\d+$/, /^phate_\d+$/, /^umap_\d+$/, /^tsne_\d+$/];

function shouldSkip(name: string, metadata: Metadata): boolean {
    if (SKIP_COLUMNS.has(name)) return true;
    if (EMBEDDING_PREFIXES.some((p) => name.startsWith(p))) return true;
    if (COORD_PATTERNS.some((p) => p.test(name))) return true;

    // Skip columns that are embedding coordinate columns from obsm
    for (const entry of Object.values(metadata.obsm)) {
        const prefix = entry.prefix;
        if (name.startsWith(`${prefix}_`)) {
            const suffix = name.slice(prefix.length + 1);
            if (/^\d+$/.test(suffix)) return true;
        }
    }

    return false;
}

let panelCounter = 0;

/**
 * Generate default chart panel entries for all eligible columns.
 *
 * - string columns → CountPlot
 * - number columns → Histogram
 * - boolean columns → CountPlot
 */
export function generateDefaultPanels(
    columns: Map<string, ColumnType>,
    metadata: Metadata,
): ChartPanelEntry[] {
    const panels: ChartPanelEntry[] = [];

    for (const [name, colType] of columns) {
        if (shouldSkip(name, metadata)) continue;

        let spec: ChartSpec;
        switch (colType) {
            case "string":
                spec = { type: "count-plot", field: name, limit: 11 };
                break;
            case "number":
                spec = { type: "histogram", field: name, bins: 20 };
                break;
            case "boolean":
                spec = { type: "count-plot", field: name, limit: 3 };
                break;
            default:
                continue;
        }

        panels.push({ id: `auto-${++panelCounter}`, spec });
    }

    return panels;
}
