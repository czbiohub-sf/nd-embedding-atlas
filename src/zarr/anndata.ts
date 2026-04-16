import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { AnnDataFrame, Convention, Dataset, DataTree } from "./types.ts";
import { SimpleDataTree } from "./data-tree.ts";
import { SimpleCoordSet, SimpleCoordArray } from "./coord-set.ts";
import { getEncodingType, readDataFrame } from "./encoding-readers.ts";
import { readDataFrameParallel } from "./parallel-reader.ts";

type ZarrGroup = zarr.Group<Readable>;
type ZarrArray = zarr.Array<zarr.DataType>;

interface LazyX {
  _lazy: true;
  _group?: ZarrGroup;
  _array?: ZarrArray;
  encoding?: string;
  shape?: number[];
  dtype: string;
}

/**
 * AnnData convention parser.
 *
 * Detects: root .zattrs has "encoding-type": "anndata"
 * Structure: X/, obs/, var/, obsm/, varm/, obsp/, varp/, layers/, uns/
 */
export const detectAnnData: Convention = {
  name: "anndata",

  detect(rootAttrs: Record<string, unknown>): boolean {
    return rootAttrs["encoding-type"] === "anndata";
  },

  async parse(group: unknown, storePath?: string): Promise<DataTree> {
    const g = group as ZarrGroup;
    const attrs = (g.attrs ?? {}) as Record<string, unknown>;

    // Parse obs and var DataFrames
    // Use parallel reader when we have a filesystem path (42x faster for large datasets)
    let obs: AnnDataFrame | undefined;
    let varDf: AnnDataFrame | undefined;

    const useParallel = !!storePath;

    try {
      if (useParallel) {
        const obsGroup = await zarr.open(g.resolve("obs"), { kind: "group" });
        const obsAttrs = (obsGroup.attrs ?? {}) as Record<string, unknown>;
        const columnOrder = (obsAttrs["column-order"] as string[]) ?? [];
        const indexName = (obsAttrs._index as string) ?? "_index";
        obs = await readDataFrameParallel(storePath, "obs", columnOrder, indexName);
      } else {
        const obsGroup = await zarr.open(g.resolve("obs"), { kind: "group" });
        obs = await readDataFrame(obsGroup as unknown as Parameters<typeof readDataFrame>[0]);
      }
    } catch (e) {
      throw new Error(`Failed to read obs DataFrame: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }

    try {
      if (useParallel) {
        const varGroup = await zarr.open(g.resolve("var"), { kind: "group" });
        const varAttrs = (varGroup.attrs ?? {}) as Record<string, unknown>;
        const columnOrder = (varAttrs["column-order"] as string[]) ?? [];
        const indexName = (varAttrs._index as string) ?? "_index";
        varDf = await readDataFrameParallel(storePath, "var", columnOrder, indexName);
      } else {
        const varGroup = await zarr.open(g.resolve("var"), { kind: "group" });
        varDf = await readDataFrame(varGroup as unknown as Parameters<typeof readDataFrame>[0]);
      }
    } catch (e) {
      // var can have 0 columns (e.g. embedding-only stores) — warn but don't crash
      console.warn(`Warning: Failed to read var DataFrame: ${e instanceof Error ? e.message : String(e)}`);
    }

    const coords: SimpleCoordArray[] = [];
    if (obs) {
      coords.push(
        new SimpleCoordArray("obs", Array.isArray(obs.index) ? obs.index : Array.from(obs.index), "string", {
          source: "obs._index",
        }),
      );
    }
    if (varDf) {
      coords.push(
        new SimpleCoordArray("var", Array.isArray(varDf.index) ? varDf.index : Array.from(varDf.index), "string", {
          source: "var._index",
        }),
      );
    }
    const coordSet = new SimpleCoordSet(coords);

    // X, obsm, layers — store lazy references only (don't load data on open)
    // X can be GB of sparse/dense data, loading it eagerly kills open() time.
    // Users access via tree.dataset.data_vars.get("X") which returns the lazy handle.
    let X: LazyX | undefined;
    try {
      const xLocation = g.resolve("X");
      try {
        const xGroup = await zarr.open(xLocation, { kind: "group" });
        const xAttrs = (xGroup.attrs ?? {}) as Record<string, unknown>;
        const encoding = getEncodingType(xAttrs);
        const shape = xAttrs.shape as number[] | undefined;
        // Lazy handle — stores metadata, reads data on demand
        X = { _lazy: true, _group: xGroup, encoding, shape, dtype: "float32" };
      } catch (groupErr) {
        try {
          const xArr = await zarr.open(xLocation, { kind: "array" });
          X = { _lazy: true, _array: xArr, shape: [...xArr.shape], dtype: xArr.dtype };
        } catch (arrayErr) {
          const groupMsg = groupErr instanceof Error ? groupErr.message : String(groupErr);
          const arrayMsg = arrayErr instanceof Error ? arrayErr.message : String(arrayErr);
          const isNotFound =
            /not\s*found/i.test(groupMsg) ||
            /not\s*found/i.test(arrayMsg) ||
            /NodeNotFoundError/i.test(groupMsg) ||
            /NodeNotFoundError/i.test(arrayMsg);
          if (!isNotFound) {
            console.warn(`Warning: X exists but failed to read — group error: ${groupMsg}, array error: ${arrayMsg}`);
          }
        }
      }
    } catch {
      // X path could not be resolved — store has no X
    }

    // Build the dataset — X is a lazy reference, obs/var are loaded
    const dataVars = new Map<string, unknown>();
    if (X) dataVars.set("X", X);

    // Extend Dataset with AnnData-specific fields
    const dataset: Dataset & {
      obs?: AnnDataFrame;
      var?: AnnDataFrame;
      _group?: unknown;
      _storePath?: string;
    } = {
      data_vars: dataVars,
      coords: coordSet,
      attrs,
      obs,
      var: varDf,
      _group: g,
      _storePath: storePath,
      async [Symbol.asyncDispose]() {
        // no-op — obs/var are in-memory, X is a lazy handle
      },
    };

    return new SimpleDataTree("", { dataset, attrs });
  },
};
