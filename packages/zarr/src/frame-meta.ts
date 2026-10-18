/**
 * obs/var frame metadata: index name, column order, column encodings and row
 * count, from zarr metadata alone. Values are read by DuckDB's `read_zarr`.
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { FrameMeta } from "./types.ts";

type ZarrGroup = zarr.Group<Readable>;

const encodingOf = (attrs: Record<string, unknown> | undefined, fallback: string) =>
  typeof attrs?.["encoding-type"] === "string" ? attrs["encoding-type"] : fallback;

/** Length of an element: an array's first dimension, or an encoded group's codes/values. */
async function elementLength(group: ZarrGroup, path: string): Promise<number> {
  const node = await zarr.open(group.resolve(path));
  if (node instanceof zarr.Array) return node.shape[0];
  const child = encodingOf(node.attrs, "") === "categorical" ? "codes" : "values";
  return (await zarr.open(group.resolve(`${path}/${child}`), { kind: "array" })).shape[0];
}

/** Metadata of the `axis` frame under `group`, or undefined if the store has no such group. */
export async function readFrameMeta(group: ZarrGroup, axis: "obs" | "var"): Promise<FrameMeta | undefined> {
  let frame: ZarrGroup;
  try {
    frame = await zarr.open(group.resolve(axis), { kind: "group" });
  } catch {
    return undefined;
  }
  const indexName = typeof frame.attrs._index === "string" ? frame.attrs._index : "_index";
  const order = frame.attrs["column-order"];
  const columns = Array.isArray(order) ? order.filter((c): c is string => typeof c === "string") : [];
  const encodings: Record<string, string> = {};
  await Promise.all(
    columns.map(async (name) => {
      const node = await zarr.open(frame.resolve(name));
      encodings[name] = encodingOf(node.attrs, "array");
    }),
  );
  return { indexName, columns, encodings, length: await elementLength(frame, indexName) };
}
