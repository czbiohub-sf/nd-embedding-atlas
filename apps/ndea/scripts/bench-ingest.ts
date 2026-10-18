#!/usr/bin/env bun

/**
 * bench:ingest: synthetic AnnData stores and an ingest benchmark that runs
 * `ndea view` from any checkout, so one harness measures every revision.
 *
 * Usage:
 *   vp run bench:ingest -- generate --n-obs 70k [--union | --mudata | --dense-x] [--n-vars 2000] [--out <dir>]
 *   vp run bench:ingest -- run <dataset.zarr | project.yaml>... [--root <checkout>] [--bin <compiled ndea>]
 *       [--port 5270] [--json] [--embedding X_umap] [--gene gene_0] [--obs-column n_counts] [--timeout 900]
 *
 * Per dataset, each server is a fresh process with a fresh `XDG_CACHE_HOME`:
 * cold start (serving = first `/api/health` 200; ready = the `Ready in` line,
 * after embedding prewarm), then first use of one embedding, one gene column
 * and one obs column, then SIGTERM; peak RSS is the server's own `maxRSS` over
 * its lifetime. A second start on the same cache is the warm run.
 */

import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { writeAnnData, writeMuData } from "./synthetic-anndata.ts";

const BENCH_DIR = "/tmp/zarr-io-bench";

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "n-obs": { type: "string" },
    "n-vars": { type: "string", default: "2000" },
    union: { type: "boolean", default: false },
    mudata: { type: "boolean", default: false },
    "dense-x": { type: "boolean", default: false },
    out: { type: "string" },
    root: { type: "string", default: resolve(import.meta.dir, "../../..") },
    bin: { type: "string" },
    port: { type: "string", default: "5270" },
    json: { type: "boolean", default: false },
    embedding: { type: "string", default: "X_umap" },
    gene: { type: "string", default: "gene_0" },
    "obs-column": { type: "string", default: "n_counts" },
    timeout: { type: "string", default: "900" },
  },
});
const [command, ...paths] = positionals;

if (command === "generate") await generate();
else if (command === "run" && paths.length > 0) await run();
else {
  console.error(
    "usage: bench-ingest.ts generate --n-obs N [--union|--mudata|--dense-x] [--out dir] | run <dataset>...",
  );
  process.exit(1);
}

async function generate(): Promise<void> {
  // `70k`, `1m`, `1e6`.
  const nObs = Number(flags["n-obs"]?.replace(/k$/i, "e3").replace(/m$/i, "e6"));
  if (!Number.isInteger(nObs) || nObs < 2) throw new Error(`--n-obs must be an integer ≥ 2 (got ${flags["n-obs"]})`);
  const label = nObs >= 1e6 ? `${nObs / 1e6}m` : `${nObs / 1e3}k`;
  const nVars = Number(flags["n-vars"]);
  const kind = flags.union ? "union" : flags.mudata ? "mudata" : flags["dense-x"] ? "dense" : "anndata";
  const out = resolve(flags.out ?? join(BENCH_DIR, "data", `${kind}-${label}${kind === "union" ? "" : ".zarr"}`));
  const t0 = performance.now();
  if (flags.union) {
    const half = Math.floor(nObs / 2);
    await rm(out, { recursive: true, force: true });
    await writeAnnData(join(out, "a.zarr"), { nObs: half, nVars, seed: 1 });
    await writeAnnData(join(out, "b.zarr"), { nObs: nObs - half, nVars, seed: 2 });
    const yaml = ["a", "b"].map((name) => `  synth_${name}:\n    anndata: ${join(out, `${name}.zarr`)}\n`).join("\n");
    await Bun.write(join(out, "project.yaml"), `datasets:\n${yaml}`);
  } else if (flags.mudata) await writeMuData(out, { nObs });
  else await writeAnnData(out, { nObs, nVars, denseX: flags["dense-x"] });
  console.log(`${flags.union ? join(out, "project.yaml") : out}  (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

interface Result {
  dataset: string;
  /** HTTP up (ingest done), before embedding prewarm. */
  coldServingS?: number;
  coldReadyS?: number;
  coldPeakRssMB?: number;
  /** First use; `">N"` past `--timeout` (later first uses are then `"skipped"`: the server is wedged). */
  embeddingS?: number | string;
  geneS?: number | string;
  obsColumnS?: number | string;
  cacheMB?: number;
  warmReadyS?: number;
  warmPeakRssMB?: number;
  error?: string;
}

async function run(): Promise<void> {
  const root = resolve(flags.root);
  const commit = Bun.spawnSync(["git", "-C", root, "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  const results: Result[] = [];
  for (const path of paths) {
    const dataset = resolve(path);
    try {
      results.push(await measure(root, dataset));
    } catch (err) {
      console.error(`${dataset}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ dataset, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
    }
  }
  if (flags.json) {
    console.log(JSON.stringify({ root, commit, results }, null, 2));
    return;
  }
  const columns: [keyof Result, string][] = [
    ["coldServingS", "cold serving (s)"],
    ["coldReadyS", "cold ready (s)"],
    ["coldPeakRssMB", "cold peak RSS (MB)"],
    ["embeddingS", "embedding (s)"],
    ["geneS", "gene (s)"],
    ["obsColumnS", "obs column (s)"],
    ["cacheMB", "cache (MB)"],
    ["warmReadyS", "warm ready (s)"],
    ["warmPeakRssMB", "warm peak RSS (MB)"],
  ];
  console.log(`${root} @ ${commit}\n`);
  console.log(`| dataset | ${columns.map(([, title]) => title).join(" | ")} |`);
  console.log(`|---|${columns.map(() => "--:").join("|")}|`);
  for (const r of results) {
    const name = r.dataset.split("/").slice(-2).join("/");
    const cells = r.error ? [`error: ${r.error}`] : columns.map(([key]) => String(r[key] ?? ""));
    console.log(`| ${name} | ${cells.join(" | ")} |`);
  }
}

async function measure(root: string, dataset: string): Promise<Result> {
  const port = Number(flags.port);
  const base = `http://127.0.0.1:${port}`;
  const health = () =>
    fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
  if (await health()) throw new Error(`port ${port} is already serving; pick another --port`);

  await mkdir(BENCH_DIR, { recursive: true });
  const tmp = await mkdtemp(join(BENCH_DIR, "run-"));
  const env = { ...process.env, XDG_CACHE_HOME: join(tmp, "cache") };
  const cmd = flags.bin ? [resolve(flags.bin)] : [process.execPath, join(root, "apps/ndea/src/cli/index.ts")];
  const args = ["view", dataset, "--no-open", "--no-tui", "--port", String(port), "--workspace", join(tmp, "ws.json")];
  let server: Bun.Subprocess | undefined;

  /**
   * Start a server. `servingS`: first `/api/health` 200 (HTTP is up after ingest);
   * `readyS`: the `Ready in` line, after embeddings are prewarmed.
   */
  const start = async (log: string): Promise<{ servingS: number; readyS: number }> => {
    const t0 = performance.now();
    const stdout = Bun.file(join(tmp, `${log}.log`));
    const proc = Bun.spawn([...cmd, ...args], {
      cwd: root,
      env,
      stdio: ["ignore", stdout, Bun.file(join(tmp, `${log}.err`))],
    });
    server = proc;
    let servingS: number | undefined;
    while (servingS === undefined || !(await stdout.text()).includes("Ready in")) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        const stderr = await Bun.file(join(tmp, `${log}.err`)).text();
        throw new Error(`server exited (${proc.exitCode ?? proc.signalCode}) before ready:\n${stderr.slice(-2000)}`);
      }
      if (performance.now() - t0 > Number(flags.timeout) * 1000) throw new Error(`not ready within ${flags.timeout}s`);
      if (servingS === undefined && (await health())) servingS = round((performance.now() - t0) / 1000);
      else await Bun.sleep(25);
    }
    return { servingS, readyS: round((performance.now() - t0) / 1000) };
  };

  /** SIGTERM (SIGKILL after 30s); the exited server's peak RSS in MB. */
  const stop = async (): Promise<number> => {
    const proc = server!;
    server = undefined;
    proc.kill("SIGTERM");
    const killer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
    await proc.exited;
    clearTimeout(killer);
    return Math.round((proc.resourceUsage()?.maxRSS ?? 0) / 2 ** 20);
  };

  const request = async (path: string, body?: unknown): Promise<Response> => {
    const post =
      body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } };
    // No idle timeout: a first use on 10M rows can stay silent past Bun's 5-minute default.
    const res = await fetch(`${base}${path}`, { ...post, timeout: false });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 500)}`);
    return res;
  };

  let wedged = false;
  const timed = async (label: string, f: () => Promise<unknown>): Promise<number | string> => {
    if (wedged) return "skipped";
    const t0 = performance.now();
    let timer: Timer | undefined;
    const deadline = new Promise<false>((ok) => (timer = setTimeout(() => ok(false), Number(flags.timeout) * 1000)));
    const done = f().then(
      () => true,
      (err: unknown) => {
        throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    const finished = await Promise.race([done, deadline]).finally(() => clearTimeout(timer));
    if (finished) return round((performance.now() - t0) / 1000);
    wedged = true;
    // The request dies with the server; its late rejection is expected.
    done.catch(() => {});
    return `>${flags.timeout}`;
  };

  try {
    const result: Result = { dataset };
    ({ servingS: result.coldServingS, readyS: result.coldReadyS } = await start("cold"));
    const dim = flags.embedding.replace(/^(.*:)?X_/, "");
    result.embeddingS = await timed("embedding", async () => {
      const query = new URLSearchParams({ embedding: flags.embedding, x_col: `${dim}_0`, y_col: `${dim}_1` });
      await (await request(`/api/scatter-positions?${query}`)).arrayBuffer();
    });
    result.geneS = await timed("gene", async () => {
      let task = (await (await request("/api/var-column", { name: flags.gene })).json()) as {
        task_id?: string;
        status: string;
      };
      const id = task.task_id;
      while (task.status === "loading") {
        await Bun.sleep(10);
        task = (await (await request(`/api/var-column/${id}/status`)).json()) as { status: string };
      }
    });
    result.obsColumnS = await timed("obs column", async () => {
      const sql = `SELECT "${flags["obs-column"]}" FROM dataset`;
      await (await request("/data/query", { type: "arrow", sql })).arrayBuffer();
    });
    result.coldPeakRssMB = await stop();
    result.cacheMB = round((await dirBytes(join(tmp, "cache", "ndea", "ingest"))) / 2 ** 20);
    result.warmReadyS = (await start("warm")).readyS;
    result.warmPeakRssMB = await stop();
    return result;
  } finally {
    if (server) {
      server.kill("SIGKILL");
      await server.exited;
    }
    await rm(tmp, { recursive: true, force: true });
  }
}

async function dirBytes(dir: string): Promise<number> {
  const names = await readdir(dir, { recursive: true }).catch(() => []);
  const sizes = await Promise.all(names.map(async (name) => (await stat(join(dir, name))).size));
  return sizes.reduce((a, b) => a + b, 0);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
