import { z } from "zod";

export interface PrqlSpan {
  start: [number, number];
  end: [number, number];
}

export interface PrqlError {
  reason: string;
  from: number;
  to: number;
}

export type PrqlResult = { ok: true; sql: string } | { ok: false; error: PrqlError };
export type WrangleSqlKind = "filter" | "reshaping" | { error: string };

const DescribeRowSchema = z.object({ column_name: z.string() });
const IterableQueryResultSchema = z.custom<Iterable<unknown>>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function",
);

type WebModule = {
  default: (input?: unknown) => Promise<unknown>;
  compile: (src: string, opts: unknown) => string;
  CompileOptions: new () => { target: string; signature_comment: boolean; format: boolean };
};

let modulePromise: Promise<WebModule> | null = null;

function load(): Promise<WebModule> {
  modulePromise ??= (async () => {
    // Browser-only WASM compiler: defer this platform module until the Wrangle
    // Body is activated so server startup never instantiates its 11 MB asset.
    const module = (await import("prql-js/dist/web")) as unknown as WebModule;
    const wasmUrl = (await import("prql-js/dist/web/prql_js_bg.wasm?url")).default;
    await module.default(wasmUrl);
    return module;
  })();
  return modulePromise;
}

function offset(src: string, line: number, column: number): number {
  const lines = src.split("\n");
  let result = 0;
  for (let index = 0; index < line && index < lines.length; index++) result += lines[index].length + 1;
  return result + column;
}

function parseError(message: string, src: string): PrqlError {
  try {
    const parsed = JSON.parse(message) as {
      inner?: { reason?: string; location?: PrqlSpan }[];
      reason?: string;
      location?: PrqlSpan;
    };
    const error = parsed.inner?.[0] ?? parsed;
    const location = error.location;
    const from = location ? offset(src, location.start[0], location.start[1]) : 0;
    const to = location ? offset(src, location.end[0], location.end[1]) : src.length;
    return { reason: error.reason ?? "PRQL error", from, to: Math.max(to, from + 1) };
  } catch {
    return { reason: message.split("\n")[0].slice(0, 200), from: 0, to: src.length };
  }
}

export async function compilePrql(prql: string, table: string): Promise<PrqlResult> {
  const trimmed = prql.trim();
  if (!trimmed) return { ok: true, sql: `SELECT * FROM ${table}` };
  const src = /^from\b/.test(trimmed) ? trimmed : `from ${table}\n${trimmed}`;
  let module: WebModule;
  try {
    module = await load();
  } catch (error) {
    return {
      ok: false,
      error: { reason: `PRQL compiler failed to load: ${String(error)}`, from: 0, to: src.length },
    };
  }
  try {
    const options = new module.CompileOptions();
    options.target = "sql.duckdb";
    options.signature_comment = false;
    options.format = false;
    return { ok: true, sql: module.compile(src, options) };
  } catch (error) {
    return { ok: false, error: parseError((error as { message?: string }).message ?? String(error), src) };
  }
}

export async function classifyWrangleSql(
  query: (sql: string, signal?: AbortSignal) => Promise<unknown>,
  sql: string,
  signal?: AbortSignal,
): Promise<WrangleSqlKind> {
  try {
    const result = await query(`DESCRIBE (${sql})`, signal);
    const rows = Array.isArray(result) ? result : Array.from(IterableQueryResultSchema.parse(result));
    const columns = z
      .array(DescribeRowSchema)
      .parse(rows)
      .map((row) => row.column_name);
    return columns.includes("__obs_index__") ? "filter" : "reshaping";
  } catch (error) {
    const raw = String((error as { message?: string }).message ?? error);
    return {
      error: raw
        .replace(/^[A-Za-z ]*Error:\s*/, "")
        .split("\n")[0]
        .slice(0, 160),
    };
  }
}
