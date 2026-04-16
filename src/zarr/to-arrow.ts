/**
 * Convert AnnDataFrame to Arrow Table via flechette.
 *
 * Mapping:
 *   TypedArray (int/float)      → Arrow numeric column (zero-copy where possible)
 *   BigInt64Array               → Arrow Int64
 *   string[]                    → Arrow Utf8
 *   CategoricalArray            → Arrow Dictionary(Int8/16/32, Utf8)
 *   NullableArray (int/bool)    → Arrow nullable column with validity bitmap
 *   NullableArray (string)      → Arrow nullable Utf8
 */

import {
    int8,
    int16,
    int32,
    int64,
    float32,
    float64,
    uint8,
    uint16,
    uint32,
    utf8,
    bool,
    tableFromArrays,
} from "@uwdata/flechette";
import type { AnnDataFrame, CategoricalArray, ColumnData, NullableArray } from "./types.ts";

/**
 * Convert an AnnDataFrame (from AnnData obs/var) to a flechette Arrow Table.
 *
 * @example
 * ```ts
 * const tree = await axial.open("./pbmc.zarr");
 * const obsTable = toArrowTable(tree.dataset.obs);
 * // obsTable is now a flechette Table — Arrow IPC compatible
 * ```
 */
export function toArrowTable(df: AnnDataFrame) {
    const arrays: Record<string, any> = {};
    const types: Record<string, any> = {};

    // Convert index
    const { col: indexCol, type: indexType } = convertColumn(df.index);
    arrays._index = indexCol;
    if (indexType) types._index = indexType;

    // Convert each column
    for (const name of df.columnOrder) {
        const data = df.column(name);
        if (!data) continue;
        const { col, type } = convertColumn(data);
        arrays[name] = col;
        if (type) types[name] = type;
    }

    // tableFromArrays creates proper Arrow columns (unlike tableFromColumns)
    return tableFromArrays(arrays, { types });
}

function convertColumn(data: ColumnData | string[] | Int32Array): { col: any; type: any } {
    // CategoricalArray → Dictionary
    if (isCategorical(data)) {
        return convertCategorical(data);
    }

    // NullableArray → nullable column
    if (isNullable(data)) {
        return convertNullable(data);
    }

    // string[] → pass through (flechette infers Utf8)
    if (Array.isArray(data)) {
        return { col: data, type: utf8() };
    }

    // BigInt64Array → Int64
    if (data instanceof BigInt64Array) {
        return { col: data, type: int64() };
    }

    if (data instanceof BigUint64Array) {
        // Arrow/flechette has no uint64. Convert to float64 to preserve values safely.
        const f64 = Float64Array.from(data, (v) => Number(v));
        return { col: f64, type: float64() };
    }

    // TypedArray → infer Arrow type
    const arrowType = typedArrayToArrowType(data);
    if (arrowType) return { col: data, type: arrowType };

    // Zarrita BoolArray or other non-standard array-like:
    // convert to plain array so flechette can handle it
    if (data && typeof data === "object" && "length" in data && Symbol.iterator in data) {
        const arr = Array.from(data as Iterable<unknown>);
        // Detect booleans
        if (typeof arr[0] === "boolean") {
            return { col: arr, type: bool() };
        }
        return { col: arr, type: undefined };
    }

    // Fallback
    return { col: data, type: undefined };
}

/**
 * Convert CategoricalArray to Arrow Dictionary column.
 * AnnData: codes (int8/16/32, -1 = null) + categories (string[])
 * Arrow: Dictionary(index_type, Utf8) with validity bitmap for nulls
 */
function convertCategorical(cat: CategoricalArray): { col: any; type: any } {
    // Decode to plain string array — flechette will handle encoding.
    // Passing dictionary() type with a decoded string[] is incoherent,
    // so we use utf8() and let flechette build its own dictionary if needed.
    const categories = cat.categories.map(String);
    const decoded: (string | null)[] = [];
    for (let i = 0; i < cat.codes.length; i++) {
        const code = cat.codes[i];
        decoded.push(code === -1 ? null : categories[code]);
    }
    return { col: decoded, type: utf8() };
}

/**
 * Convert NullableArray to Arrow column with validity bitmap.
 * AnnData mask: Uint8Array where 1 = null, 0 = valid
 * Arrow validity: 1 = valid, 0 = null (inverted!)
 */
function convertNullable(na: NullableArray): { col: any; type: any } {
    const values = na.values;
    const len = na.mask.length;

    // For string values, build array with nulls
    if (typeof values[0] === "string" || Array.isArray(values)) {
        const result: (string | null)[] = [];
        for (let i = 0; i < len; i++) {
            result.push(na.mask[i] ? null : String(values[i]));
        }
        return { col: result, type: utf8() };
    }

    // For numeric values, build array with nulls
    // flechette accepts arrays with null for nullable columns
    const result: (number | bigint | null)[] = [];
    for (let i = 0; i < len; i++) {
        result.push(na.mask[i] ? null : (values[i] as number | bigint));
    }

    // Infer type from underlying values (Uint8Array maps to bool for nullable booleans)
    const type =
        values instanceof Uint8Array ? bool() : (typedArrayToArrowType(values) ?? float64());

    return { col: result, type };
}

/** Map a TypedArray to its Arrow type, or undefined if not a recognized TypedArray. */
function typedArrayToArrowType(data: unknown): any {
    if (data instanceof Float32Array) return float32();
    if (data instanceof Float64Array) return float64();
    if (data instanceof Int8Array) return int8();
    if (data instanceof Int16Array) return int16();
    if (data instanceof Int32Array) return int32();
    if (data instanceof BigInt64Array) return int64();
    if (data instanceof Uint8Array) return uint8();
    if (data instanceof Uint16Array) return uint16();
    if (data instanceof Uint32Array) return uint32();
    return undefined;
}

// Type guards

function isCategorical(data: unknown): data is CategoricalArray {
    return (
        data !== null &&
        typeof data === "object" &&
        "codes" in data &&
        "categories" in data &&
        "ordered" in data
    );
}

function isNullable(data: unknown): data is NullableArray {
    return (
        data !== null &&
        typeof data === "object" &&
        "values" in data &&
        "mask" in data &&
        !("codes" in data)
    );
}
