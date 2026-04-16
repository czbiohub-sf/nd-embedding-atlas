/**
 * ObsSet CRUD + activate endpoints.
 *
 * GET    /api/obssets              — List all observation sets
 * POST   /api/obssets              — Create a new observation set
 * DELETE /api/obssets/{obsset_id}  — Delete an observation set
 * POST   /api/obssets/{obsset_id}/activate — Get SQL predicate for filtering
 */

import { CreateObsSetBodySchema, parseJsonBody } from "../protocol.ts";
import type { EmbeddingStore } from "../store.ts";

/**
 * Handle GET /api/obssets
 *
 * Lists all ObsSets with live current_count via JOIN.
 */
export async function handleListObsSets(store: EmbeddingStore): Promise<Response> {
  try {
    const rows = await store.queryJson(`
            SELECT
                o.obsset_id,
                o.name,
                o.color,
                o.created_at,
                o.created_count,
                COUNT(m.obs_name) AS current_count
            FROM obssets o
            LEFT JOIN obsset_members m USING (obsset_id)
            GROUP BY o.obsset_id, o.name, o.color, o.created_at, o.created_count
            ORDER BY o.created_at
        `);

    // Coerce created_at to ISO string
    const result = rows.map((row) => {
      const ca = row.created_at;
      let created_at: string | null;
      if (ca && typeof ca === "object" && "toISOString" in ca) {
        created_at = (ca as Date).toISOString();
      } else if (typeof ca === "string" || typeof ca === "number" || typeof ca === "bigint") {
        created_at = String(ca);
      } else {
        created_at = null;
      }
      return { ...row, created_at };
    });

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle POST /api/obssets
 *
 * Creates a new ObsSet from the request body.
 */
export async function handleCreateObsSet(req: Request, store: EmbeddingStore): Promise<Response> {
  const parsed = await parseJsonBody(req, CreateObsSetBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const obssetId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const members = body.members ?? [];
    const createdCount = members.length;

    await store.execute(
      `INSERT INTO obssets (obsset_id, name, color, created_at, created_count) ` +
        `VALUES ('${obssetId}', '${body.name.replace(/'/g, "''")}', ` +
        `${body.color ? `'${body.color.replace(/'/g, "''")}'` : "NULL"}, ` +
        `'${createdAt}', ${createdCount})`,
    );

    // Insert members in batches
    if (members.length > 0) {
      const batchSize = 500;
      for (let start = 0; start < members.length; start += batchSize) {
        const end = Math.min(start + batchSize, members.length);
        const values = members
          .slice(start, end)
          .map((m) => `('${obssetId}', '${m.dataset_key.replace(/'/g, "''")}', '${m.obs_name.replace(/'/g, "''")}')`)
          .join(", ");
        await store.execute(`INSERT OR IGNORE INTO obsset_members (obsset_id, dataset_key, obs_name) VALUES ${values}`);
      }
    }

    return Response.json(
      {
        obsset_id: obssetId,
        name: body.name,
        color: body.color ?? null,
        created_at: createdAt,
        created_count: createdCount,
        current_count: createdCount,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle DELETE /api/obssets/{obsset_id}
 *
 * Deletes an ObsSet and all its members.
 */
export async function handleDeleteObsSet(obssetId: string, store: EmbeddingStore): Promise<Response> {
  try {
    // Explicit cascade — DuckDB does not enforce FK cascades
    const safeId = obssetId.replace(/'/g, "''");
    await store.execute(`DELETE FROM obsset_members WHERE obsset_id = '${safeId}'`);
    await store.execute(`DELETE FROM obssets WHERE obsset_id = '${safeId}'`);

    return Response.json({ deleted: obssetId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle POST /api/obssets/{obsset_id}/activate
 *
 * Returns a Mosaic-compatible SQL predicate for the ObsSet.
 */
export async function handleActivateObsSet(obssetId: string, store: EmbeddingStore): Promise<Response> {
  try {
    const safeId = obssetId.replace(/'/g, "''");
    const rows = await store.queryJson(`SELECT 1 FROM obssets WHERE obsset_id = '${safeId}'`);

    if (rows.length === 0) {
      return Response.json({ error: `ObsSet '${obssetId}' not found` }, { status: 404 });
    }

    const predicate = `(_dataset, obs_name) IN (SELECT dataset_key, obs_name FROM obsset_members WHERE obsset_id = '${safeId}')`;

    return Response.json({ predicate });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
