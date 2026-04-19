/**
 * OME-Zarr (NGFF) detector + minimal parser.
 *
 * In production the OME-Zarr pipeline runs through `server/plate.ts`
 * (iohub-style mount + channel metadata). The `open()` entry is kept only
 * so callers who hand us a plate root don't hit an "unknown convention"
 * error — result exposes multiscales metadata and the group handle; callers
 * reach into those directly if they need the resolution hierarchy.
 */

import type * as zarr from "zarrita";
import type { Readable } from "zarrita";
import type { ParsedOmeZarr } from "./types.ts";

type ZarrGroup = zarr.Group<Readable>;

export function detectOmeZarr(rootAttrs: Record<string, unknown>): boolean {
  return "multiscales" in rootAttrs;
}

export function parseOmeZarr(group: ZarrGroup, storePath?: string): Promise<ParsedOmeZarr> {
  const attrs = (group.attrs ?? {}) as Record<string, unknown>;
  const multiscales = (attrs.multiscales as unknown[] | undefined) ?? [];
  return Promise.resolve({
    kind: "ome-zarr",
    attrs,
    group,
    storePath,
    multiscales,
  });
}
