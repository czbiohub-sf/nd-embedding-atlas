/**
 * write-obs — append columns to an AnnData `.obs` group on disk (zarr v2 + v3).
 *
 * This is the "commit" half of the annotation flow: DuckDB `ann_*` tables are
 * the live staging layer; this writes selected columns back into the source
 * AnnData zarr on an explicit user prompt. Validated end-to-end against anndata
 * for both formats and every dtype (see `spike/`).
 *
 * Two encoders, dispatched by the store's on-disk format:
 *   - v3: zarrita `create`/`set` + a custom `vlen-utf8` codec (upstream encode
 *     is unimplemented) registered into zarrita's mutable codec registry.
 *   - v2: hand-written `.zgroup`/`.zarray`/`.zattrs` + raw chunk bytes,
 *     `compressor:null` (anndata reads via `.zarray`, so no blosc encoder).
 *
 * Alignment is by durable obs_name against the target store's `_index`; obs not
 * present in a column's value map become NA (categorical code -1, float NaN).
 * Column arrays are written first, then `column-order` LAST (crash-consistency),
 * and stale consolidated metadata is dropped so readers re-scan.
 */

import { rename } from "node:fs/promises";
import path from "node:path";
import * as zarr from "zarrita";
import type { Location, Mutable } from "zarrita";
import { BunFileStore } from "./bun-store.ts";
import { asMutable } from "./zarr-boundary.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// ── Custom vlen-utf8 codec (encode is unimplemented upstream) ─────────────────

let writeCodecRegistered = false;
export function registerWriteCodec(): void {
  if (writeCodecRegistered) return;
  const reg = (zarr as unknown as { registry: Map<string, () => Promise<unknown>> }).registry;
  const getStrides = (zarr as unknown as { _zarrita_internal_getStrides: (s: number[], o: "C") => number[] })
    ._zarrita_internal_getStrides;

  class WritableVLenUTF8 {
    kind = "array_to_bytes";
    #shape: number[];
    constructor(shape: number[]) {
      this.#shape = shape;
    }
    static fromConfig(_c: unknown, meta: { shape: number[] }) {
      return new WritableVLenUTF8(meta.shape);
    }
    encode(chunk: { data: ArrayLike<string> }): Uint8Array {
      return vlenEncode(chunk.data);
    }
    decode(bytes: Uint8Array): { data: string[]; shape: number[]; stride: number[] } {
      return { data: vlenDecode(bytes), shape: this.#shape, stride: getStrides(this.#shape, "C") };
    }
  }
  reg.set("vlen-utf8", () => Promise.resolve(WritableVLenUTF8));
  writeCodecRegistered = true;
}

/** numcodecs VLenUTF8 wire format: [uint32 LE count][ per item: uint32 LE byteLen | utf8 ]. */
export function vlenEncode(strings: ArrayLike<string>): Uint8Array {
  const parts = Array.from({ length: strings.length }, (_, i) => TEXT_ENCODER.encode(strings[i] ?? ""));
  const buf = new Uint8Array(4 + parts.reduce((n, p) => n + 4 + p.byteLength, 0));
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setUint32(o, strings.length, true);
  o += 4;
  for (const p of parts) {
    dv.setUint32(o, p.byteLength, true);
    o += 4;
    buf.set(p, o);
    o += p.byteLength;
  }
  return buf;
}

function vlenDecode(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const data: string[] = Array(view.getUint32(0, true));
  let pos = 4;
  for (let i = 0; i < data.length; i++) {
    const len = view.getUint32(pos, true);
    pos += 4;
    data[i] = TEXT_DECODER.decode(bytes.subarray(pos, pos + len));
    pos += len;
  }
  return data;
}

// ── Public types ──────────────────────────────────────────────────────────────

export type ObsColumnInput =
  | { name: string; kind: "categorical"; values: Map<string, string | null> }
  | { name: string; kind: "string"; values: Map<string, string | null> }
  | { name: string; kind: "float"; values: Map<string, number | boolean | null> }
  | { name: string; kind: "int"; values: Map<string, number | boolean | null> }
  | { name: string; kind: "bool"; values: Map<string, number | boolean | null> };

export interface CommitReport {
  format: "v2" | "v3";
  nObs: number;
  columns: { name: string; kind: string; nNonNull: number }[];
  written: boolean;
}

const ARRAY_ATTRS = { "encoding-type": "array", "encoding-version": "0.2.0" };
const STRARR_ATTRS = { "encoding-type": "string-array", "encoding-version": "0.2.0" };
const CAT_ATTRS = { ordered: false, "encoding-type": "categorical", "encoding-version": "0.2.0" };

// ── Format detection + index read ─────────────────────────────────────────────

async function detectFormat(store: BunFileStore): Promise<"v2" | "v3"> {
  if (await store.exists("/zarr.json")) return "v3";
  if (await store.exists("/.zgroup")) return "v2";
  throw new Error("not a zarr store: no /zarr.json or /.zgroup at root");
}

/**
 * Read obs row labels in on-disk order (zarrita reads both v2 and v3). The index
 * array's name comes from the obs group's `_index` attribute (the original
 * DataFrame index name, often but NOT always "_index"). AnnData may store it as
 * a plain `string-array` OR a `nullable-string-array` group (`values` + `mask`);
 * in the nullable case the labels live in the `values` child.
 */
async function readObsIndex(store: BunFileStore): Promise<string[]> {
  const root = zarr.root(asMutable(store));
  const obsGroup = await zarr.open(root.resolve("/obs"), { kind: "group" });
  const indexName = (obsGroup.attrs as { _index?: string })._index ?? "_index";
  const node = await zarr.open(root.resolve(`/obs/${indexName}`));
  const arr =
    node instanceof zarr.Group ? await zarr.open(root.resolve(`/obs/${indexName}/values`), { kind: "array" }) : node;
  const chunk = await zarr.get(arr as never, null);
  return Array.from(chunk.data as ArrayLike<string>);
}

// ── Alignment ─────────────────────────────────────────────────────────────────

/** Build a dense codes+categories pair from a per-obs-name label map. */
function alignCategorical(obsNames: string[], values: Map<string, string | null>) {
  const cats = [...new Set([...values.values()].filter((v): v is string => v != null))].toSorted();
  const codeOf = new Map(cats.map((c, i) => [c, i]));
  const codes = Int8Array.from(obsNames, (name) => {
    const v = values.get(name);
    return v == null ? -1 : codeOf.get(v)!;
  });
  return { cats, codes, nNonNull: codes.reduce((n, c) => n + (c >= 0 ? 1 : 0), 0) };
}

function alignNumeric(
  obsNames: string[],
  values: Map<string, number | boolean | null>,
  kind: "float" | "int" | "bool",
) {
  let nNonNull = 0;
  const get = (name: string): number => {
    const v = values.get(name);
    if (v == null) return kind === "float" ? Number.NaN : 0;
    nNonNull++;
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  };
  const data =
    kind === "float"
      ? Float64Array.from(obsNames, get)
      : kind === "int"
        ? Int32Array.from(obsNames, get)
        : Uint8Array.from(obsNames, get); // bool → 0/1 bytes
  return { data, nNonNull };
}

function alignStrings(obsNames: string[], values: Map<string, string | null>) {
  let nNonNull = 0;
  const data = obsNames.map((name) => {
    const v = values.get(name);
    if (v != null) nNonNull++;
    return v ?? "";
  });
  return { data, nNonNull };
}

// ── v3 writer (zarrita) ───────────────────────────────────────────────────────

const V3_BYTES = [{ name: "bytes", configuration: { endian: "little" } }];
const V3_VLEN = [{ name: "vlen-utf8", configuration: {} }];
type WritableZarrLocation = Location<Mutable>;

async function v3Numeric(loc: WritableZarrLocation, key: string, dtype: string, data: unknown, n: number) {
  const arr = await zarr.create(loc.resolve(key), {
    shape: [n],
    chunkShape: [n],
    dtype,
    codecs: V3_BYTES,
    fillValue: 0,
    attributes: ARRAY_ATTRS,
  } as never);
  await zarr.set(arr as never, null, { data, shape: [n], stride: [1] } as never);
}

async function v3StringArray(loc: WritableZarrLocation, key: string, strings: string[], n: number) {
  const arr = await zarr.create(loc.resolve(key), {
    shape: [n],
    chunkShape: [n],
    dtype: "string",
    codecs: V3_VLEN,
    fillValue: "",
    attributes: STRARR_ATTRS,
  } as never);
  await zarr.set(arr as never, null, { data: strings, shape: [n], stride: [1] } as never);
}

async function writeColumnV3(store: BunFileStore, col: ObsColumnInput, obsNames: string[]): Promise<number> {
  const loc = zarr.root(asMutable(store));
  const n = obsNames.length;
  const base = `/obs/${col.name}`;
  if (col.kind === "categorical") {
    const { cats, codes, nNonNull } = alignCategorical(obsNames, col.values);
    await zarr.create(loc.resolve(base), { attributes: CAT_ATTRS } as never);
    await v3Numeric(loc, `${base}/codes`, "int8", codes, n);
    await v3StringArray(loc, `${base}/categories`, cats, cats.length);
    return nNonNull;
  }
  if (col.kind === "string") {
    const { data, nNonNull } = alignStrings(obsNames, col.values);
    await v3StringArray(loc, base, data, n);
    return nNonNull;
  }
  const { data, nNonNull } = alignNumeric(obsNames, col.values, col.kind);
  const BoolArray = (zarr as unknown as { BoolArray: new (b: Uint8Array) => unknown }).BoolArray;
  const dtype = col.kind === "float" ? "float64" : col.kind === "int" ? "int32" : "bool";
  const payload = col.kind === "bool" ? new BoolArray(data as Uint8Array) : data;
  await v3Numeric(loc, base, dtype, payload, n);
  return nNonNull;
}

// ── v2 writer (hand-written files) ────────────────────────────────────────────

const V2_BASE = { order: "C", dimension_separator: ".", compressor: null, zarr_format: 2 };
const writeJSON = (store: BunFileStore, key: string, obj: unknown) =>
  store.set(key, TEXT_ENCODER.encode(JSON.stringify(obj)));

async function v2Numeric(store: BunFileStore, key: string, dtype: string, fill: unknown, chunk: Uint8Array, n: number) {
  await writeJSON(store, `${key}/.zarray`, {
    shape: [n],
    chunks: [n],
    dtype,
    fill_value: fill,
    filters: null,
    ...V2_BASE,
  });
  await writeJSON(store, `${key}/.zattrs`, ARRAY_ATTRS);
  await store.set(`${key}/0`, chunk);
}

async function v2StringArray(store: BunFileStore, key: string, strings: string[], n: number) {
  await writeJSON(store, `${key}/.zarray`, {
    shape: [n],
    chunks: [n],
    dtype: "|O",
    fill_value: "",
    filters: [{ id: "vlen-utf8" }],
    ...V2_BASE,
  });
  await writeJSON(store, `${key}/.zattrs`, STRARR_ATTRS);
  await store.set(`${key}/0`, vlenEncode(strings));
}

async function writeColumnV2(store: BunFileStore, col: ObsColumnInput, obsNames: string[]): Promise<number> {
  const n = obsNames.length;
  const base = `/obs/${col.name}`;
  if (col.kind === "categorical") {
    const { cats, codes, nNonNull } = alignCategorical(obsNames, col.values);
    await writeJSON(store, `${base}/.zgroup`, { zarr_format: 2 });
    await writeJSON(store, `${base}/.zattrs`, CAT_ATTRS);
    await v2Numeric(store, `${base}/codes`, "|i1", 0, new Uint8Array(codes.buffer), n);
    await v2StringArray(store, `${base}/categories`, cats, cats.length);
    return nNonNull;
  }
  if (col.kind === "string") {
    const { data, nNonNull } = alignStrings(obsNames, col.values);
    await v2StringArray(store, base, data, n);
    return nNonNull;
  }
  const { data, nNonNull } = alignNumeric(obsNames, col.values, col.kind);
  const dtype = col.kind === "float" ? "<f8" : col.kind === "int" ? "<i4" : "|b1";
  const fill = col.kind === "bool" ? false : 0;
  const chunk = col.kind === "bool" ? (data as Uint8Array) : new Uint8Array((data as Float64Array | Int32Array).buffer);
  await v2Numeric(store, base, dtype, fill, chunk, n);
  return nNonNull;
}

// ── Atomic metadata publish ───────────────────────────────────────────────────

/** Write `key` via temp-file + rename so a torn write can't corrupt metadata. */
async function atomicWrite(rootPath: string, key: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(rootPath, key.replace(/^\//, ""));
  const tmp = `${abs}.tmp-${process.pid}`;
  await Bun.write(tmp, bytes);
  await rename(tmp, abs);
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Append `columns` to the AnnData obs group at `rootPath`. Aligns each column to
 * the store's `_index` by obs_name. Set `dryRun` to compute the report without
 * writing. Caller must ensure column names don't collide with existing obs
 * columns (enforced at annotation-creation time via datasetColumnExists).
 */
export async function commitObsColumns(
  rootPath: string,
  columns: ObsColumnInput[],
  opts: { dryRun?: boolean } = {},
): Promise<CommitReport> {
  registerWriteCodec();
  const store = new BunFileStore(rootPath);
  const format = await detectFormat(store);
  const obsNames = await readObsIndex(store);
  const n = obsNames.length;

  if (opts.dryRun) {
    return {
      format,
      nObs: n,
      columns: columns.map((c) => ({
        name: c.name,
        kind: c.kind,
        nNonNull: [...c.values.values()].filter((v) => v != null).length,
      })),
      written: false,
    };
  }

  // 1. Write column arrays first (orphans are harmless until referenced).
  const report: CommitReport["columns"] = [];
  for (const col of columns) {
    const nNonNull =
      format === "v3" ? await writeColumnV3(store, col, obsNames) : await writeColumnV2(store, col, obsNames);
    report.push({ name: col.name, kind: col.kind, nNonNull });
  }

  // 2. Publish: append to obs column-order LAST, atomically.
  const obsMetaKey = format === "v3" ? "/obs/zarr.json" : "/obs/.zattrs";
  const obsMeta = JSON.parse(TEXT_DECODER.decode(await store.get(obsMetaKey)));
  const attrs = format === "v3" ? obsMeta.attributes : obsMeta;
  const order: string[] = attrs["column-order"];
  for (const c of columns) if (!order.includes(c.name)) order.push(c.name);
  await atomicWrite(rootPath, obsMetaKey, TEXT_ENCODER.encode(JSON.stringify(obsMeta)));

  // 3. Drop stale consolidated metadata so readers re-scan the live tree.
  if (format === "v3") {
    const rootMeta = JSON.parse(TEXT_DECODER.decode(await store.get("/zarr.json")));
    if ("consolidated_metadata" in rootMeta) {
      delete rootMeta.consolidated_metadata;
      await atomicWrite(rootPath, "/zarr.json", TEXT_ENCODER.encode(JSON.stringify(rootMeta)));
    }
  } else {
    await store.delete("/.zmetadata");
  }

  return { format, nObs: n, columns: report, written: true };
}
