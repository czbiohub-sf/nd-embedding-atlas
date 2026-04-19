/**
 * AnnData convention detector + parser.
 *
 * Detects: root `.zattrs` has `"encoding-type": "anndata"`.
 * Structure: X/, obs/, var/, obsm/, varm/, obsp/, varp/, layers/, uns/
 *
 * Returns a `ParsedAnnData` — no DataTree / Dataset / CoordSet ceremony.
 * obs / var DataFrames are eagerly loaded (Phase C will make them lazy);
 * X / obsm / layers stay on disk until the caller asks.
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { AnnDataFrame, ParsedAnnData } from "./types.ts";
import { readDataFrame } from "./encoding-readers.ts";
import { readDataFrameParallel } from "./parallel-reader.ts";

type ZarrGroup = zarr.Group<Readable>;

export function detectAnnData(rootAttrs: Record<string, unknown>): boolean {
  return rootAttrs["encoding-type"] === "anndata";
}

export async function parseAnnData(group: ZarrGroup, storePath?: string): Promise<ParsedAnnData> {
  const attrs = (group.attrs ?? {}) as Record<string, unknown>;
  const obs = await readAxisFrame(group, "obs", storePath, /*required*/ true);
  const varDf = await readAxisFrame(group, "var", storePath, /*required*/ false);
  return {
    kind: "anndata",
    obs,
    var: varDf,
    attrs,
    group,
    storePath,
  };
}

/**
 * Read an axis DataFrame (obs or var). Parallel reader if we have a local
 * filesystem path (42x faster on large stores), else fall back to sequential.
 * `required=false` swallows missing-group errors — var can legitimately be
 * empty on embedding-only stores.
 */
async function readAxisFrame(
  group: ZarrGroup,
  axis: "obs" | "var",
  storePath: string | undefined,
  required: boolean,
): Promise<AnnDataFrame | undefined> {
  try {
    const axisGroup = await zarr.open(group.resolve(axis), { kind: "group" });
    if (storePath) {
      const axisAttrs = (axisGroup.attrs ?? {}) as Record<string, unknown>;
      const columnOrder = (axisAttrs["column-order"] as string[]) ?? [];
      const indexName = (axisAttrs._index as string) ?? "_index";
      return await readDataFrameParallel(storePath, axis, columnOrder, indexName);
    }
    return await readDataFrame(axisGroup as unknown as Parameters<typeof readDataFrame>[0]);
  } catch (e) {
    if (required) {
      throw new Error(`Failed to read ${axis} DataFrame: ${e instanceof Error ? e.message : String(e)}`, {
        cause: e,
      });
    }
    console.warn(`Warning: failed to read ${axis} DataFrame: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
