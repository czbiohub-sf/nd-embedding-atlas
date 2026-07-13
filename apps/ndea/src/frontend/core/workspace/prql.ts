/**
 * PRQL → DuckDB SQL — the wrangle node's compiler.
 *
 * prql-js ships three builds; we use the WEB entry (`dist/web` + explicit
 * `init()`): the bundler entry's `wasm?import` 500s in Vite dev (needs
 * vite-plugin-wasm), while the web entry instantiates explicitly and lets
 * the bundler serve the .wasm as a normal asset — no plugin, and it matches
 * our lazy-load-WASM-in-the-node-body pattern. The 11MB WASM loads once, on
 * first compile, off the main bundle.
 *
 * Compilation is CLIENT-side; the output is plain SQL that rides the same
 * coordinator → /mosaic → server DuckDB path every other query uses.
 */

export interface PrqlSpan {
  /** [line, col] 0-based, from prqlc's error location */
  start: [number, number];
  end: [number, number];
}

export interface PrqlError {
  reason: string;
  /** char offsets into the source (derived from prqlc location) — for CM diagnostics */
  from: number;
  to: number;
}

export type PrqlResult = { ok: true; sql: string } | { ok: false; error: PrqlError };

type WebModule = {
  default: (input?: unknown) => Promise<unknown>;
  compile: (src: string, opts: unknown) => string;
  CompileOptions: new () => { target: string; signature_comment: boolean; format: boolean };
};

let modPromise: Promise<WebModule> | null = null;

function load(): Promise<WebModule> {
  modPromise ??= (async () => {
    const mod = (await import("prql-js/dist/web")) as unknown as WebModule;
    // bundler-controlled asset URL — robust across Vite (dev/prod) and Bun.build,
    // instead of relying on prqlc's internal `new URL(..., import.meta.url)`
    const wasmUrl = (await import("prql-js/dist/web/prql_js_bg.wasm?url")).default;
    await mod.default(wasmUrl);
    return mod;
  })();
  return modPromise;
}

/** offset of [line,col] (0-based) within src — prqlc reports line/col, CM wants offsets */
function offset(src: string, line: number, col: number): number {
  const lines = src.split("\n");
  let o = 0;
  for (let i = 0; i < line && i < lines.length; i++) o += lines[i].length + 1;
  return o + col;
}

function parseError(message: string, src: string): PrqlError {
  try {
    const parsed = JSON.parse(message) as {
      inner?: { reason?: string; location?: PrqlSpan }[];
      reason?: string;
      location?: PrqlSpan;
    };
    const e = parsed.inner?.[0] ?? parsed;
    const loc = e.location;
    const from = loc ? offset(src, loc.start[0], loc.start[1]) : 0;
    const to = loc ? offset(src, loc.end[0], loc.end[1]) : src.length;
    return { reason: e.reason ?? "PRQL error", from, to: Math.max(to, from + 1) };
  } catch {
    return { reason: message.split("\n")[0].slice(0, 200), from: 0, to: src.length };
  }
}

/**
 * Compile a PRQL pipeline to a DuckDB `SELECT`. A bare pipeline (no leading
 * `from`) is prefixed with `from {table}` — the common wrangle case is just
 * `filter …` / `derive …` over the node's input.
 */
export async function compilePrql(prql: string, table: string): Promise<PrqlResult> {
  const trimmed = prql.trim();
  if (!trimmed) return { ok: true, sql: `SELECT * FROM ${table}` };
  const src = /^from\b/.test(trimmed) ? trimmed : `from ${table}\n${trimmed}`;
  let mod: WebModule;
  try {
    mod = await load();
  } catch (e) {
    return { ok: false, error: { reason: `PRQL compiler failed to load: ${String(e)}`, from: 0, to: src.length } };
  }
  try {
    const opts = new mod.CompileOptions();
    opts.target = "sql.duckdb";
    opts.signature_comment = false;
    opts.format = false;
    return { ok: true, sql: mod.compile(src, opts) };
  } catch (e) {
    return { ok: false, error: parseError((e as { message?: string }).message ?? String(e), src) };
  }
}
