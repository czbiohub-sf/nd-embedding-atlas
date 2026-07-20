/**
 * Open a zarr store and detect its convention.
 *
 * Local filesystem paths use BunFileStore + parallel-worker reads (42x
 * speed-up on large stores). HTTP(S) URLs use zarrita's FetchStore.
 *
 * Returns a `ParsedStore` discriminated by `kind`. Callers branch:
 *
 *   const parsed = await open("./data.zarr");
 *   if (parsed.kind === "anndata") { ... }
 */

import * as zarr from "zarrita";
import type { Readable } from "zarrita";
import { BunFileStore } from "./bun-store.ts";
import { asReadable } from "./zarr-boundary.ts";
import type { ParsedOmeZarr, ParsedStore } from "./types.ts";
import { detectAnnData, parseAnnData } from "./anndata.ts";
import { detectMuData, parseMuData } from "./mudata.ts";

type ZarrGroup = zarr.Group<Readable>;

// ─── OME-Zarr (inline) ──────────────────────────────────────────────────────
// In production the OME-Zarr pipeline runs through `server/plate.ts`
// (iohub-style mount + channel metadata). The detector + parser here exist so
// callers who hand us a plate root don't hit an "unknown convention" error :
// result exposes multiscales metadata and the group handle; callers reach into
// those directly if they need the resolution hierarchy.

function detectOmeZarr(rootAttrs: Record<string, unknown>): boolean {
  return "multiscales" in rootAttrs;
}

function parseOmeZarr(group: ZarrGroup, storePath?: string): Promise<ParsedOmeZarr> {
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

/** Detector + parser pairs, probed in order. First `detect()` win parses. */
const CONVENTIONS: readonly {
  detect: (attrs: Record<string, unknown>) => boolean;
  parse: (group: ZarrGroup, storePath?: string) => Promise<ParsedStore>;
}[] = [
  { detect: detectOmeZarr, parse: parseOmeZarr },
  { detect: detectMuData, parse: parseMuData },
  { detect: detectAnnData, parse: parseAnnData },
];

export async function open(location: string | Readable): Promise<ParsedStore> {
  let store: Readable;
  let storePath: string | undefined;

  if (typeof location === "string") {
    const isRemote = location.startsWith("http://") || location.startsWith("https://");
    if (isRemote) {
      store = new zarr.FetchStore(location);
    } else {
      store = asReadable(new BunFileStore(location));
      storePath = location;
    }
  } else {
    store = location;
  }

  const root = await zarr.open(store, { kind: "group" });
  const rootAttrs = (root.attrs ?? {}) as Record<string, unknown>;

  for (const conv of CONVENTIONS) {
    if (conv.detect(rootAttrs)) return conv.parse(root, storePath);
  }

  throw new Error(
    "Unknown zarr convention. Expected OME-Zarr (multiscales), AnnData " +
      "(encoding-type: anndata), or MuData (encoding-type: MuData). " +
      `Root attrs: ${JSON.stringify(Object.keys(rootAttrs))}`,
  );
}
