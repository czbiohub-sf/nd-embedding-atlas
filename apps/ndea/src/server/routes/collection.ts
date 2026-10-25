/**
 * POST /api/collection { name }: re-open the server session on another
 * collection of the project (re-ingest, new `dataset` VIEW). Responds once the
 * new session serves; `session/watch` then tells every tab to reload.
 */

import { z } from "zod";
import type { ServerSession } from "../state.ts";

const BodySchema = z.object({ name: z.string() });

let switching: string | null = null;

export async function handleCollectionSwitch(
  req: Request,
  state: ServerSession,
  switchCollection: ((name: string) => Promise<void>) | undefined,
): Promise<Response> {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "expected { name: string }" }, { status: 400 });
  const { name } = body.data;
  if (!state.status.collections.some((c) => c.name === name)) {
    return Response.json({ error: `unknown collection '${name}'` }, { status: 404 });
  }
  if (name === state.status.collection) return Response.json({ collection: name });
  if (!switchCollection) return Response.json({ error: "this server cannot switch collections" }, { status: 501 });
  if (switching) return Response.json({ error: `already switching to '${switching}'` }, { status: 409 });
  switching = name;
  try {
    await switchCollection(name);
    return Response.json({ collection: name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    switching = null;
  }
}
