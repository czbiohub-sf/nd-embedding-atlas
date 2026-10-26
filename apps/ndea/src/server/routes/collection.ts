/**
 * POST /api/collection { name }: serve another collection of the project
 * through the `SessionHost` (re-ingest, new `dataset` VIEW). Responds once the
 * new session serves; `session/watch` then tells every tab to reload.
 *   200 { collection } · 404 unknown · 409 another switch runs · 501 no host.
 */

import { z } from "zod";
import { parseBody } from "../request-body.ts";
import type { SessionHost } from "../session-host.ts";

const BodySchema = z.object({ name: z.string() });

export async function handleCollectionSwitch(req: Request, sessions: SessionHost | undefined): Promise<Response> {
  const body = await parseBody(req, BodySchema);
  if (body instanceof Response) return body;
  const { name } = body;
  if (!sessions) return Response.json({ error: "this server cannot switch collections" }, { status: 501 });
  try {
    const result = await sessions.switchTo(name);
    if (result.kind === "unknown") return Response.json({ error: `unknown collection '${name}'` }, { status: 404 });
    if (result.kind === "busy") {
      return Response.json({ error: `already switching to '${result.target}'` }, { status: 409 });
    }
    return Response.json({ collection: name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
