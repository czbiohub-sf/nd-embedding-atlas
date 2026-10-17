import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { OBSERVATION_SET_TABLE, ObservationSetIdSchema, type ObservationSet } from "@ndea/protocol";
import { stateDir } from "../cli/lib/paths.ts";
import type { WorkspaceIssue } from "../frontend/core/workspace/document.ts";
import type { WorkspaceDocument } from "../frontend/core/workspace/types.ts";
import type { DatasetQuerySession } from "./store.ts";

const SetFileSchema = z
  .object({
    version: z.literal(1),
    members: z.array(z.tuple([z.string().nullable(), z.string()])),
  })
  .strict();
// Scratch tables for one `run` at a time: the queue serializes every use.
const WORDS = "ndea_set_words";
const MEMBERS = "ndea_set_members";
export const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Row bitmask: bit `r & 31` of word `r >> 5` is row `r` (`__row_index__`). */
export function rowWords(rows: Iterable<number>): Uint32Array {
  let max = -1;
  for (const row of rows) max = Math.max(max, row);
  const words = new Uint32Array(Math.floor(max / 32) + 1);
  for (const row of rows) words[Math.floor(row / 32)] |= 1 << (row % 32);
  return words;
}

export class UnknownObservationRows extends Error {}

/** Durable identities on disk, session row handles on the Mosaic connection. */
export class ObservationSets {
  // ponytail: sets stay loaded for the process lifetime; add eviction only if memory becomes a constraint.
  private readonly loaded = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialized = false;

  private readonly store: DatasetQuerySession;
  private readonly directory: string;

  constructor(store: DatasetQuerySession, directory = join(stateDir(), "sets")) {
    this.store = store;
    this.directory = directory;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.initialized) {
        await this.store.execute(
          `CREATE TEMP TABLE ${OBSERVATION_SET_TABLE} (set_id VARCHAR, __row_index__ UINTEGER); ` +
            `CREATE TEMP TABLE ${WORDS} (w UINTEGER, bits UINTEGER); ` +
            `CREATE TEMP TABLE ${MEMBERS} (dataset VARCHAR, obs_name VARCHAR)`,
        );
        this.initialized = true;
      }
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  /** Persist the rows set in `words` (see `rowWords`); the same rows always get the same id. */
  create(words: Uint32Array): Promise<ObservationSet> {
    return this.run(async () => {
      const { conn } = this.store;
      await conn.run(`DELETE FROM ${WORDS}; DELETE FROM ${MEMBERS}`);
      const appender = await conn.createAppender(WORDS);
      for (let w = 0; w < words.length; w++) {
        if (words[w] === 0) continue;
        appender.appendUInteger(w);
        appender.appendUInteger(words[w]);
        appender.endRow();
      }
      appender.closeSync();
      // Expand the bitmask in DuckDB and resolve each row to its durable identity.
      await conn.run(
        `INSERT INTO ${MEMBERS} SELECT ${this.store.hasDatasetColumn() ? "_dataset" : "NULL"}, obs_name FROM dataset ` +
          `WHERE __row_index__ IN (SELECT w * 32 + b FROM ${WORDS}, range(32) t(b) WHERE (bits >> b::UINTEGER) & 1 = 1)`,
      );
      const [{ expected }] = await this.store.querySingleJson(
        `SELECT coalesce(sum(bit_count(bits)), 0)::BIGINT AS expected FROM ${WORDS}`,
      );
      // An empty result has no column chunks at all.
      const [datasets = [], names = []] = (
        await conn.runAndReadAll(`SELECT dataset, obs_name FROM ${MEMBERS}`)
      ).getColumnsJS();
      if (names.length === 0) throw new UnknownObservationRows("empty observation set");
      if (names.length !== expected) throw new UnknownObservationRows("unknown observation row indices");
      const members = new Map<string, [string | null, string]>();
      for (let i = 0; i < names.length; i++) {
        const dataset = datasets[i] as string | null;
        const name = names[i] as string;
        members.set(`${dataset ?? ""}\u0000${name}`, [dataset, name]);
      }
      const keys = [...members.keys()].toSorted();
      const set = new Bun.CryptoHasher("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
      if (!this.loaded.has(set)) {
        await mkdir(this.directory, { recursive: true });
        const path = join(this.directory, `${set}.json`);
        const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await Bun.write(tmp, JSON.stringify({ version: 1, members: keys.map((key) => members.get(key)!) }));
        await rename(tmp, path);
        await this.load(set);
      }
      return { set, count: keys.length };
    });
  }

  ensure(ids: readonly string[]): Promise<string[]> {
    return this.run(async () => {
      const missing: string[] = [];
      for (const set of new Set(ids)) {
        ObservationSetIdSchema.parse(set);
        if (this.loaded.has(set)) continue;
        const handle = Bun.file(join(this.directory, `${set}.json`));
        if (!(await handle.exists())) {
          missing.push(set);
          continue;
        }
        const file = SetFileSchema.parse(JSON.parse(await handle.text()));
        await this.store.execute(`DELETE FROM ${MEMBERS}`);
        const appender = await this.store.conn.createAppender(MEMBERS);
        for (const [dataset, name] of file.members) {
          if (dataset === null) appender.appendNull();
          else appender.appendVarchar(dataset);
          appender.appendVarchar(name);
          appender.endRow();
        }
        appender.closeSync();
        await this.load(set);
      }
      return missing;
    });
  }

  /** Load `set`'s rows: every dataset row whose identity is in the members table. */
  private async load(set: string): Promise<void> {
    // Remove a partial insert left by a failed load before retrying. `set` is validated hex.
    await this.store.execute(`DELETE FROM ${OBSERVATION_SET_TABLE} WHERE set_id = '${set}'`);
    await this.store.execute(
      `INSERT INTO ${OBSERVATION_SET_TABLE} SELECT DISTINCT '${set}', d.__row_index__ ` +
        `FROM dataset d JOIN ${MEMBERS} m ON d.obs_name::VARCHAR = m.obs_name ` +
        `AND ${this.store.hasDatasetColumn() ? "d._dataset" : "NULL"} IS NOT DISTINCT FROM m.dataset`,
    );
    this.loaded.add(set);
  }
}

/** Find structural set clauses anywhere in the document, including element props. */
export async function observationSetIssues(
  document: WorkspaceDocument,
  sets: ObservationSets,
): Promise<WorkspaceIssue[]> {
  const references: { set: string; pointer: string }[] = [];
  function visit(value: unknown, pointer: string): void {
    if (value === null || typeof value !== "object") return;
    if ("op" in value && value.op === "inSet" && "set" in value && typeof value.set === "string") {
      references.push({ set: value.set, pointer });
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, `${pointer}/${escapePointer(key)}`);
    }
  }
  visit(document, "");
  const missing = new Set(await sets.ensure(references.map(({ set }) => set)));
  return references
    .filter(({ set }) => missing.has(set))
    .map(({ set, pointer }) => ({ pointer, detail: `unknown observation set "${set}"` }));
}
