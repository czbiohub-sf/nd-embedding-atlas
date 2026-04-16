/**
 * AnnData encoding-type readers.
 * Dispatches on encoding-type attr to read each element correctly.
 *
 * Encoding types handled:
 *   array, categorical, nullable-string-array, nullable-integer,
 *   nullable-boolean, csr_matrix, csc_matrix, dataframe, string-array,
 *   numeric-scalar, string, null
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type {
    AnnDataFrame,
    CategoricalArray,
    ColumnData,
    EncodingType,
    NullableArray,
    Scalar,
    SparseArray,
} from "../core/types.ts";
import { SimpleCategorical, SimpleNullable } from "../core/categorical.ts";
import { CsrCscArray } from "../core/sparse.ts";

// zarrita group/array types are complex — use structural typing
type ZarrGroup = Awaited<ReturnType<typeof zarr.open<Readable>>> & {
    resolve: (path: string) => any;
    attrs: Record<string, unknown>;
};

/** Read encoding-type from a group or array's attrs. */
export function getEncodingType(attrs: Record<string, unknown>): EncodingType | undefined {
    return attrs["encoding-type"] as EncodingType | undefined;
}

/** Read a zarr array and return its full data as a typed array. */
async function readArray(location: any): Promise<{ data: any; shape: number[]; dtype: string }> {
    const arr = await zarr.open(location, { kind: "array" });
    const result = await zarr.get(arr);
    return { data: result.data, shape: [...arr.shape], dtype: arr.dtype };
}

/**
 * Read a categorical column.
 * Structure: group with codes/ array and categories/ (which may be a plain array
 * or a nullable-string-array group with values/ + mask/).
 */
export async function readCategorical(group: ZarrGroup): Promise<CategoricalArray> {
    const ordered = (group.attrs.ordered as boolean) ?? false;

    // Read codes
    const { data: codes } = await readArray(group.resolve("codes"));

    // Categories might be a plain array or a nullable-string-array group
    let categories: Scalar[];
    try {
        // Try as plain array first
        const { data: catData } = await readArray(group.resolve("categories"));
        categories = Array.isArray(catData) ? catData : Array.from(catData);
    } catch {
        // It's a group (nullable-string-array) — read values/ sub-array
        const catGroup = await zarr.open(group.resolve("categories"), { kind: "group" });
        const { data: values } = await readArray((catGroup as any).resolve("values"));
        categories = Array.isArray(values) ? values : Array.from(values);
        // mask indicates null categories — rare but handle it
    }

    return new SimpleCategorical(categories, codes, ordered);
}

/**
 * Read a nullable array (values/ + mask/ pattern).
 * Used for nullable-integer, nullable-boolean, nullable-string, nullable-string-array.
 */
export async function readNullable(group: ZarrGroup): Promise<NullableArray> {
    const { data: values } = await readArray(group.resolve("values"));
    const { data: mask } = await readArray(group.resolve("mask"));

    // Convert BoolArray to Uint8Array if needed (zarrita returns BoolArray for bool dtype)
    const maskU8 =
        mask instanceof Uint8Array ? mask : Uint8Array.from(mask, (v: any) => (v ? 1 : 0));

    return new SimpleNullable(values, maskU8);
}

/**
 * Read a sparse matrix (CSR or CSC).
 * Structure: group with data/, indices/, indptr/ arrays and shape in attrs.
 */
export async function readSparse(group: ZarrGroup): Promise<SparseArray> {
    const encoding = getEncodingType(group.attrs);
    const format = encoding === "csc_matrix" ? "csc" : "csr";
    const shape = group.attrs.shape as [number, number];

    const [{ data }, { data: indices }, { data: indptr }] = await Promise.all([
        readArray(group.resolve("data")),
        readArray(group.resolve("indices")),
        readArray(group.resolve("indptr")),
    ]);

    return new CsrCscArray({ shape, format, data, indices, indptr });
}

/**
 * Read an AnnData DataFrame (obs or var).
 * Structure: group with _index attr, column-order attr, and each column as a sub-element.
 */
export async function readDataFrame(group: ZarrGroup): Promise<AnnDataFrame> {
    const indexName = group.attrs._index as string | undefined;
    if (!indexName) {
        throw new Error(
            'DataFrame group is missing "_index" attr — cannot determine index column name',
        );
    }
    const columnOrder = (group.attrs["column-order"] as string[]) ?? [];

    // Read index column
    const indexCol = await readElement(group, indexName);
    const index = extractValues(indexCol);

    // Read each column in order
    const columns = new Map<string, ColumnData>();
    const readPromises = columnOrder.map(async (colName) => {
        const colData = await readElement(group, colName);
        columns.set(colName, colData);
    });
    await Promise.all(readPromises);

    return {
        index: index as string[] | Int32Array,
        columns,
        columnOrder,
        column(name: string) {
            return columns.get(name);
        },
        *[Symbol.iterator]() {
            const len = index.length;
            for (let i = 0; i < len; i++) {
                const row: Record<string, Scalar | null> = {};
                for (const [name, col] of columns) {
                    row[name] = getValueAt(col, i);
                }
                yield row;
            }
        },
    };
}

/**
 * Read a single element by dispatching on its encoding-type.
 * This is the main dispatch function.
 */
export async function readElement(parentGroup: ZarrGroup, name: string): Promise<ColumnData> {
    const location = parentGroup.resolve(name);

    // Try opening as a group first (categorical, nullable, sparse, dataframe are groups)
    try {
        const group = await zarr.open(location, { kind: "group" });
        const attrs = (group.attrs ?? {}) as Record<string, unknown>;
        const encoding = getEncodingType(attrs);

        switch (encoding) {
            case "categorical":
                return (await readCategorical(group as any)) as unknown as ColumnData;
            case "nullable-integer":
            case "nullable-boolean":
            case "nullable-string":
            case "nullable-string-array":
                return (await readNullable(group as any)) as unknown as ColumnData;
            case "csr_matrix":
            case "csc_matrix":
                return (await readSparse(group as any)) as unknown as ColumnData;
            default:
                // Unknown group encoding — try reading as plain array
                break;
        }
    } catch (err) {
        // Only fall through to array read if the error indicates "not found" / "not a group".
        // Network errors, corruption, etc. should propagate.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/not\s*found/i.test(msg) && !/NotFound/i.test(msg)) {
            throw new Error(`Failed to read element "${name}": ${msg}`);
        }
    }

    // Read as plain array
    const { data } = await readArray(location);
    return data;
}

// Helpers

function extractValues(col: ColumnData): string[] | Int32Array | any[] {
    if (col instanceof Int32Array) return col;
    if (Array.isArray(col)) return col;
    if ("values" in col && "mask" in col) {
        // NullableArray — extract values, replacing masked with empty string
        const na = col as NullableArray;
        const result: string[] = [];
        for (let i = 0; i < na.length; i++) {
            const v = na.at(i);
            result.push(v !== null ? String(v) : "");
        }
        return result;
    }
    if ("codes" in col && "categories" in col) {
        return (col as CategoricalArray).toArray() as any[];
    }
    // TypedArray — convert to regular array
    return Array.from(col as any);
}

function getValueAt(col: ColumnData, i: number): Scalar | null {
    if ("at" in col && typeof col.at === "function") {
        return (col as CategoricalArray | NullableArray).at(i);
    }
    if (Array.isArray(col)) return col[i];
    return (col as any)[i];
}
