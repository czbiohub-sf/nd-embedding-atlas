import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  OBSERVATION_SET_TABLE,
  ObservationSetCreateBodySchema,
  ObservationSetIdSchema,
  type FilterClause,
  type ObservationSet,
} from "@ndea/protocol";
import { stateDir } from "../cli/lib/paths.ts";
import type { WorkspaceDocument, WorkspaceIssue } from "../frontend/core/workspace/document.ts";
import type { DatasetQuerySession } from "./store.ts";

const SetFileSchema = z
  .object({
    version: z.literal(1),
    members: z.array(z.tuple([z.string().nullable(), z.string()])),
  })
  .strict();
const IdentityRowSchema = z.object({
  obs_name: z.union([z.string(), z.number()]),
  _dataset: z.string().nullable().optional(),
});
const BATCH_SIZE = 10_000;
const literal = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
const escapePointer = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");

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
        await this.store.execute(`CREATE TEMP TABLE ${OBSERVATION_SET_TABLE} (set_id VARCHAR, __row_index__ UINTEGER)`);
        this.initialized = true;
      }
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  create(rowIndices: readonly number[]): Promise<ObservationSet> {
    return this.run(async () => {
      ObservationSetCreateBodySchema.parse({ rowIndices });
      const indices = [...new Set(rowIndices)];
      const multi = await this.store.hasDatasetColumn();
      const members = new Map<string, [string | null, string]>();
      for (let offset = 0; offset < indices.length; offset += BATCH_SIZE) {
        const batch = indices.slice(offset, offset + BATCH_SIZE);
        const rows = await this.store.querySingleJson(
          `SELECT __row_index__, obs_name${multi ? ", _dataset" : ""} FROM dataset WHERE __row_index__ IN (${batch.join(",")})`,
        );
        if (rows.length !== batch.length) throw new UnknownObservationRows("unknown observation row indices");
        for (const row of rows) {
          const identity = IdentityRowSchema.parse(row);
          const dataset = multi ? (identity._dataset ?? null) : null;
          const name = String(identity.obs_name);
          members.set(`${dataset ?? ""}\u0000${name}`, [dataset, name]);
        }
      }
      const keys = [...members.keys()].toSorted();
      const set = new Bun.CryptoHasher("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
      if (!this.loaded.has(set)) {
        await mkdir(this.directory, { recursive: true });
        const path = join(this.directory, `${set}.json`);
        const tmp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
        await Bun.write(tmp, JSON.stringify({ version: 1, members: keys.map((key) => members.get(key)!) }));
        await rename(tmp, path);
        await this.load(
          set,
          keys.map((key) => members.get(key)!),
        );
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
        await this.load(set, file.members);
      }
      return missing;
    });
  }

  private async load(set: string, members: [string | null, string][]): Promise<void> {
    const multi = await this.store.hasDatasetColumn();
    // Remove a partial insert left by a failed load before retrying.
    await this.store.execute(`DELETE FROM ${OBSERVATION_SET_TABLE} WHERE set_id = ${literal(set)}`);
    for (let offset = 0; offset < members.length; offset += BATCH_SIZE) {
      const values = members
        .slice(offset, offset + BATCH_SIZE)
        .map(([dataset, name]) => `(${literal(dataset)}, ${literal(name)})`)
        .join(",");
      await this.store.execute(
        `INSERT INTO ${OBSERVATION_SET_TABLE} SELECT DISTINCT ${literal(set)}, d.__row_index__ ` +
          `FROM dataset d JOIN (VALUES ${values}) AS m(dataset, obs_name) ON d.obs_name = m.obs_name ` +
          `AND ${multi ? "d._dataset" : "NULL"} IS NOT DISTINCT FROM m.dataset`,
      );
    }
    this.loaded.add(set);
  }
}

/** Only clause structure is walked; strings in column names and values are not references. */
export async function observationSetIssues(
  document: WorkspaceDocument,
  sets: ObservationSets,
): Promise<WorkspaceIssue[]> {
  const references: { set: string; pointer: string }[] = [];
  function visit(clause: FilterClause, pointer: string): void {
    if (clause.op === "inSet") references.push({ set: clause.set, pointer });
    else if (clause.op === "and" || clause.op === "or") {
      clause.clauses.forEach((child, index) => visit(child, `${pointer}/clauses/${index}`));
    } else if (clause.op === "not") visit(clause.clause, `${pointer}/clause`);
  }
  for (const [scope, sources] of Object.entries(document.state.filter ?? {})) {
    for (const [source, facets] of Object.entries(sources)) {
      for (const [facet, clause] of Object.entries(facets)) {
        visit(clause, `/state/filter/${escapePointer(scope)}/${escapePointer(source)}/${escapePointer(facet)}`);
      }
    }
  }
  const missing = new Set(await sets.ensure(references.map(({ set }) => set)));
  return references
    .filter(({ set }) => missing.has(set))
    .map(({ set, pointer }) => ({ pointer, detail: `unknown observation set "${set}"` }));
}
