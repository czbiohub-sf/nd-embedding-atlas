/**
 * Synthetic AnnData / MuData stores for `bench-ingest.ts`, in the Zarr v3
 * layout anndata 0.11 writes (`zarr_format=3`): one `zarr.json` per node,
 * anndata `encoding-type`/`encoding-version` attrs, zarr-python 3 default
 * codecs (`bytes` or `vlen-utf8`, then `zstd` level 0) and `guess_chunks`
 * chunking, and inline consolidated metadata in the root `zarr.json`.
 *
 * Metadata and chunks are written directly (not through zarrita's `set`) so
 * every array streams one chunk band at a time: memory stays O(chunk) at 10M
 * cells. Values come from a counter-based hash, so output is deterministic
 * per seed and independent of chunking.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";

type Numeric = Float32Array | Float64Array | Int8Array | Int16Array | Int32Array | Uint32Array | Uint8Array;
type Band = Numeric | BigInt64Array | string[];
/** Rows `[r0, r1)` of an array, row-major (`(r1 - r0) * width` values). */
type Gen = (r0: number, r1: number) => Band;
type DType = "float32" | "float64" | "int8" | "int16" | "int32" | "int64" | "uint32" | "bool" | "string";

const ITEM_SIZE: Record<DType, number> = {
  float32: 4,
  float64: 8,
  int8: 1,
  int16: 2,
  int32: 4,
  int64: 8,
  uint32: 4,
  bool: 1,
  // zarr-python 3 sizes variable-length strings as 1 byte when guessing chunks.
  string: 1,
};
const ZSTD = { name: "zstd", configuration: { level: 0, checksum: false } };
const ARRAY = { "encoding-type": "array", "encoding-version": "0.2.0" };
const STRING_ARRAY = { "encoding-type": "string-array", "encoding-version": "0.2.0" };
const DICT = { "encoding-type": "dict", "encoding-version": "0.1.0" };
const TEXT_ENCODER = new TextEncoder();

/** zarr-python's `_guess_chunks`: halve dims in turn until near a size target that grows with the array. */
function guessChunks(shape: number[], typesize: number): number[] {
  const chunks = shape.map((s) => Math.max(s, 1));
  const bytes = () => chunks.reduce((a, b) => a * b, 1) * typesize;
  const target = Math.min(64 * 2 ** 20, Math.max(128 * 2 ** 10, 256 * 2 ** 10 * 2 ** Math.log10(bytes() / 2 ** 20)));
  for (let idx = 0; ; idx++) {
    const size = bytes();
    if ((size < target || Math.abs(size - target) / target < 0.5) && size < 64 * 2 ** 20) break;
    if (size === typesize) break;
    chunks[idx % chunks.length] = Math.ceil(chunks[idx % chunks.length] / 2);
  }
  return chunks;
}

/** numcodecs VLenUTF8: `[u32 count][per item: u32 byteLength, utf8]`, little-endian. */
function vlenEncode(strings: string[]): Uint8Array {
  const parts = strings.map((s) => TEXT_ENCODER.encode(s));
  const out = new Uint8Array(4 + parts.reduce((n, p) => n + 4 + p.byteLength, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, parts.length, true);
  let o = 4;
  for (const p of parts) {
    view.setUint32(o, p.byteLength, true);
    out.set(p, o + 4);
    o += 4 + p.byteLength;
  }
  return out;
}

function hash(stream: number, i: number): number {
  let h = Math.imul(i ^ Math.imul(stream, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ stream, 0x85ebca6b);
  return (h ^ (h >>> 15)) >>> 0;
}
const rand = (stream: number, i: number) => hash(stream, i) / 2 ** 32;
const normal = (stream: number, i: number) => (rand(stream, i) + rand(stream + 1, i) + rand(stream + 2, i) - 1.5) * 2;

/** Row-major band generator over `width` columns. */
function gen(Ctor: new (n: number) => Numeric, width: number, f: (i: number, j: number) => number): Gen {
  return (r0, r1) => {
    const out = new Ctor((r1 - r0) * width);
    for (let i = r0, k = 0; i < r1; i++) for (let j = 0; j < width; j++) out[k++] = f(i, j);
    return out;
  };
}
const genBig =
  (f: (i: number) => number): Gen =>
  (r0, r1) =>
    BigInt64Array.from({ length: r1 - r0 }, (_, k) => BigInt(f(r0 + k)));
const genStr =
  (f: (i: number) => string): Gen =>
  (r0, r1) =>
    Array.from({ length: r1 - r0 }, (_, k) => f(r0 + k));

class ZarrV3Writer {
  readonly #meta: Record<string, object> = {};
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }

  async #node(path: string, meta: object): Promise<void> {
    this.#meta[path] = meta;
    await Bun.write(join(this.dir, path, "zarr.json"), JSON.stringify(meta, null, 2));
  }

  group(path: string, attributes: object = {}): Promise<void> {
    return this.#node(path, { zarr_format: 3, node_type: "group", attributes });
  }

  async array(path: string, dtype: DType, shape: number[], generate: Gen, attributes: object = {}): Promise<void> {
    const chunk = guessChunks(shape, ITEM_SIZE[dtype]);
    const isString = dtype === "string";
    await this.#node(path, {
      zarr_format: 3,
      node_type: "array",
      shape,
      data_type: dtype,
      chunk_grid: { name: "regular", configuration: { chunk_shape: chunk } },
      chunk_key_encoding: { name: "default", configuration: { separator: "/" } },
      fill_value: isString ? "" : dtype === "bool" ? false : 0,
      codecs: [
        isString ? { name: "vlen-utf8", configuration: {} } : { name: "bytes", configuration: { endian: "little" } },
        ZSTD,
      ],
      attributes,
      storage_transformers: [],
    });
    const [nRows, width = 1] = shape;
    const [cr, cc = 1] = chunk;
    for (let r0 = 0; r0 < nRows; r0 += cr) {
      const band = generate(r0, Math.min(nRows, r0 + cr));
      const rows = band.length / width;
      for (let c0 = 0; c0 < width; c0 += cc) {
        // Edge chunks are stored full-size, padded with the fill value.
        const out = isString
          ? Array.from({ length: cr * cc }, () => "")
          : new (band.constructor as new (n: number) => Numeric)(cr * cc);
        const src = band as unknown as ArrayLike<unknown>;
        const dst = out as unknown as unknown[];
        for (let r = 0; r < rows; r++) {
          for (let c = c0; c < Math.min(width, c0 + cc); c++) dst[r * cc + c - c0] = src[r * width + c];
        }
        const raw = isString ? vlenEncode(out as string[]) : new Uint8Array((out as Numeric).buffer);
        const key = shape.length === 1 ? `c/${r0 / cr}` : `c/${r0 / cr}/${c0 / cc}`;
        await Bun.write(join(this.dir, path, key), Bun.zstdCompressSync(raw, { level: 3 }));
      }
    }
  }

  /** Root `zarr.json` last, with every other node inlined as zarr-python's consolidated metadata. */
  async close(attributes: object): Promise<void> {
    const { "": _root, ...metadata } = this.#meta;
    await Bun.write(
      join(this.dir, "zarr.json"),
      JSON.stringify(
        {
          zarr_format: 3,
          node_type: "group",
          attributes,
          consolidated_metadata: { kind: "inline", must_understand: false, metadata },
        },
        null,
        2,
      ),
    );
  }
}

async function dataframe(
  w: ZarrV3Writer,
  path: string,
  index: Gen,
  n: number,
  columns: Record<string, (path: string) => Promise<void>>,
) {
  await w.group(path, {
    _index: "_index",
    "column-order": Object.keys(columns),
    "encoding-type": "dataframe",
    "encoding-version": "0.2.0",
  });
  await w.array(`${path}/_index`, "string", [n], index, STRING_ARRAY);
  for (const [name, write] of Object.entries(columns)) await write(`${path}/${name}`);
}

const numeric = (w: ZarrV3Writer, dtype: DType, n: number, g: Gen) => (path: string) =>
  w.array(path, dtype, [n], g, ARRAY);

function categorical(w: ZarrV3Writer, n: number, categories: string[], code: (i: number) => number) {
  return async (path: string) => {
    await w.group(path, { "encoding-type": "categorical", "encoding-version": "0.2.0", ordered: false });
    const wide = categories.length > 127;
    await w.array(`${path}/codes`, wide ? "int16" : "int8", [n], gen(wide ? Int16Array : Int8Array, 1, code), ARRAY);
    await w.array(
      `${path}/categories`,
      "string",
      [categories.length],
      (r0, r1) => categories.slice(r0, r1),
      STRING_ARRAY,
    );
  };
}

export interface AnnDataOptions {
  nObs: number;
  nVars?: number;
  seed?: number;
  /** Dense float32 X instead of CSR. */
  denseX?: boolean;
  varPrefix?: string;
}

/** One AnnData group at `prefix` ("" = store root, or e.g. `mod/rna`). */
async function writeAnnDataGroup(w: ZarrV3Writer, prefix: string, opts: AnnDataOptions): Promise<void> {
  const { nObs: n, nVars = 2000, seed = 1, denseX = false, varPrefix = "gene_" } = opts;
  const s = seed * 64;
  const at = (key: string) => (prefix ? `${prefix}/${key}` : key);
  const cellType = (i: number) => hash(s + 7, i) % 12;
  const obs: Record<string, (path: string) => Promise<void>> = {
    n_genes: numeric(
      w,
      "int32",
      n,
      gen(Int32Array, 1, (i) => 200 + (hash(s, i) % 4000)),
    ),
    n_counts: numeric(
      w,
      "float32",
      n,
      gen(Float32Array, 1, (i) => (200 + (hash(s, i) % 4000)) * (1.5 + rand(s + 1, i))),
    ),
    total_umis: numeric(
      w,
      "int64",
      n,
      genBig((i) => hash(s + 2, i) % 100_000),
    ),
    pct_mito: numeric(
      w,
      "float64",
      n,
      gen(Float64Array, 1, (i) => rand(s + 3, i) * 20),
    ),
    is_doublet: numeric(
      w,
      "bool",
      n,
      gen(Uint8Array, 1, (i) => (rand(s + 4, i) < 0.05 ? 1 : 0)),
    ),
    age: async (path) => {
      await w.group(path, { "encoding-type": "nullable-integer", "encoding-version": "0.1.0" });
      await w.array(
        `${path}/values`,
        "int32",
        [n],
        gen(Int32Array, 1, (i) => 20 + (hash(s + 5, i) % 60)),
        ARRAY,
      );
      await w.array(
        `${path}/mask`,
        "bool",
        [n],
        gen(Uint8Array, 1, (i) => (rand(s + 6, i) < 0.1 ? 1 : 0)),
        ARRAY,
      );
    },
    sample: categorical(w, n, ["ctrl", "stim"], (i) => hash(s + 8, i) % 2),
    cell_type: categorical(
      w,
      n,
      Array.from({ length: 12 }, (_, k) => `type_${k}`),
      (i) => (rand(s + 9, i) < 0.05 ? -1 : cellType(i)),
    ),
    clone: categorical(
      w,
      n,
      Array.from({ length: 200 }, (_, k) => `clone_${String(k).padStart(3, "0")}`),
      (i) => hash(s + 10, i) % 200,
    ),
    barcode: numeric(
      w,
      "string",
      n,
      genStr(
        (i) =>
          `${hash(s + 11, i)
            .toString(16)
            .padStart(8, "0")}-1`,
      ),
    ),
    score: numeric(
      w,
      "float32",
      n,
      gen(Float32Array, 1, (i) => normal(s + 12, i)),
    ),
    doublet_score: numeric(
      w,
      "float64",
      n,
      gen(Float64Array, 1, (i) => rand(s + 15, i)),
    ),
  };

  await w.group(prefix, { "encoding-type": "anndata", "encoding-version": "0.1.0" });
  await dataframe(
    w,
    at("obs"),
    genStr((i) => `cell_${i}`),
    n,
    obs,
  );
  await dataframe(
    w,
    at("var"),
    genStr((j) => `${varPrefix}${j}`),
    nVars,
    {
      mean_expr: numeric(
        w,
        "float32",
        nVars,
        gen(Float32Array, 1, (j) => rand(s + 16, j)),
      ),
    },
  );

  await w.group(at("obsm"), DICT);
  const umap = (i: number, j: number) => {
    const angle = (cellType(i) / 12) * 2 * Math.PI;
    return 10 * (j === 0 ? Math.cos(angle) : Math.sin(angle)) + normal(s + 17 + j * 3, i);
  };
  await w.array(at("obsm/X_umap"), "float32", [n, 2], gen(Float32Array, 2, umap), ARRAY);
  await w.array(
    at("obsm/X_scvi"),
    "float32",
    [n, 10],
    gen(Float32Array, 10, (i, j) => normal(s + 23, i * 64 + j)),
    ARRAY,
  );
  const pca = (i: number, j: number) => normal(s + 26, i * 64 + j) * (10 / (j + 1));
  await w.array(at("obsm/X_pca"), "float32", [n, 50], gen(Float32Array, 50, pca), ARRAY);
  for (const key of ["layers", "obsp", "varm", "varp", "uns"]) await w.group(at(key), DICT);

  if (denseX) {
    const x = (i: number, j: number) => (rand(s + 29, i * 4096 + j) < 0.02 ? 1 + (hash(s + 30, i * 4096 + j) % 10) : 0);
    await w.array(at("X"), "float32", [n, nVars], gen(Float32Array, nVars, x), ARRAY);
    return;
  }
  // CSR, ~20 nnz/row (10..30): sorted distinct columns, one per `nVars / nnz` stride.
  const indptr = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) indptr[i + 1] = indptr[i] + Math.min(nVars, 10 + (hash(s + 31, i) % 21));
  const nnz = indptr[n];
  const elements = (f: (row: number, k: number, e: number) => number, Ctor: new (n: number) => Numeric): Gen => {
    return (e0, e1) => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (indptr[mid] <= e0) lo = mid;
        else hi = mid - 1;
      }
      const out = new Ctor(e1 - e0);
      for (let e = e0, row = lo; e < e1; e++) {
        while (indptr[row + 1] <= e) row++;
        out[e - e0] = f(row, e - indptr[row], e);
      }
      return out;
    };
  };
  const column = (row: number, k: number) => {
    const step = Math.floor(nVars / (indptr[row + 1] - indptr[row]));
    return k * step + (hash(s + 32, row * 32 + k) % step);
  };
  await w.group(at("X"), { "encoding-type": "csr_matrix", "encoding-version": "0.1.0", shape: [n, nVars] });
  await w.array(
    at("X/data"),
    "float32",
    [nnz],
    elements((_row, _k, e) => 1 + (hash(s + 33, e) % 10), Float32Array),
  );
  await w.array(at("X/indices"), "int32", [nnz], elements(column, Int32Array));
  await w.array(
    at("X/indptr"),
    "int64",
    [n + 1],
    genBig((i) => indptr[i]),
  );
}

export async function writeAnnData(dir: string, opts: AnnDataOptions): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  const w = new ZarrV3Writer(dir);
  await writeAnnDataGroup(w, "", opts);
  await w.close({ "encoding-type": "anndata", "encoding-version": "0.1.0" });
}

/** MuData: `mod/rna` (CSR X), `mod/prot` (dense 30-var X), global obs/var/obsm, obsmap/varmap. */
export async function writeMuData(dir: string, { nObs: n, seed = 1 }: { nObs: number; seed?: number }): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  const w = new ZarrV3Writer(dir);
  const mods = { rna: 2000, prot: 30 };
  await w.group("mod", { "mod-order": Object.keys(mods) });
  await writeAnnDataGroup(w, "mod/rna", { nObs: n, nVars: mods.rna, seed });
  await writeAnnDataGroup(w, "mod/prot", {
    nObs: n,
    nVars: mods.prot,
    seed: seed + 1,
    denseX: true,
    varPrefix: "prot_",
  });

  const s = seed * 64;
  const nVars = mods.rna + mods.prot;
  await dataframe(
    w,
    "obs",
    genStr((i) => `cell_${i}`),
    n,
    {
      sample: categorical(w, n, ["ctrl", "stim"], (i) => hash(s + 8, i) % 2),
      // ponytail: real MuData names these `rna:n_genes`, but zarrita resolves `rna:` as a URL scheme and cd2c5fa drops the shared obs.
      rna_n_genes: numeric(
        w,
        "int32",
        n,
        gen(Int32Array, 1, (i) => 200 + (hash(s, i) % 4000)),
      ),
      global_score: numeric(
        w,
        "float32",
        n,
        gen(Float32Array, 1, (i) => normal(s + 40, i)),
      ),
    },
  );
  await dataframe(
    w,
    "var",
    genStr((j) => (j < mods.rna ? `gene_${j}` : `prot_${j - mods.rna}`)),
    nVars,
    {},
  );
  await w.group("obsm", DICT);
  await w.array(
    "obsm/X_umap",
    "float32",
    [n, 2],
    gen(Float32Array, 2, (i, j) => normal(s + 43, i * 2 + j) * 5),
    ARRAY,
  );
  for (const key of ["obsp", "varm", "varp", "uns"]) await w.group(key, DICT);
  await w.group("obsmap");
  await w.group("varmap");
  let offset = 0;
  for (const [mod, size] of Object.entries(mods)) {
    // 1-based row in the modality, 0 = absent.
    await w.array(
      `obsmap/${mod}`,
      "uint32",
      [n],
      gen(Uint32Array, 1, (i) => i + 1),
    );
    const start = offset;
    await w.array(
      `varmap/${mod}`,
      "uint32",
      [nVars],
      gen(Uint32Array, 1, (j) => (j >= start && j < start + size ? j - start + 1 : 0)),
    );
    offset += size;
  }
  await w.close({ "encoding-type": "MuData", "encoding-version": "0.1.0", encoder: "mudata", axis: 0 });
}
