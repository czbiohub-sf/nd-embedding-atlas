import type { Convention, DataTree } from "./types.ts";
import { SimpleDataTree } from "./data-tree.ts";

/**
 * xarray convention parser (fallback).
 *
 * Detects:
 *   V3: any array has dimension_names in zarr.json
 *   V2: any array has _ARRAY_DIMENSIONS in .zattrs, or .zmetadata exists
 *
 * Uses CF conventions for decoding (_FillValue, scale_factor, add_offset, calendar).
 */
export const detectXarray: Convention = {
    name: "xarray",

    detect(_rootAttrs: Record<string, unknown>): boolean {
        // Weakest detection — acts as fallback.
        // Check for xarray-specific markers in root attrs.
        // In practice, most xarray stores have coordinates listed or _ARRAY_DIMENSIONS
        // on sub-arrays, but we can't check those without opening children.
        // Accept any Zarr group as potential xarray store.
        return true;
    },

    async parse(group: any): Promise<DataTree> {
        const attrs = (group.attrs ?? {}) as Record<string, unknown>;
        const root = new SimpleDataTree("", { attrs });

        // TODO: Parse xarray structure:
        // V3 path: read dimension_names from each array's zarr.json
        // V2 path: read _ARRAY_DIMENSIONS from each array's .zattrs
        //          or .zmetadata (consolidated) for all at once
        // Classify: arrays whose name matches a dim name → coordinates
        // CF decode: _FillValue, scale_factor, add_offset, calendar/units

        return root;
    },
};
