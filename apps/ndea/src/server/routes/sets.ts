import { ObservationSetCreateBodySchema, ObservationSetSchema } from "@ndea/protocol";
import { UnknownObservationRows } from "../observation-sets.ts";
import { parseJsonBody } from "../protocol.ts";
import type { ServerSession } from "../state.ts";

export async function handleSetsPost(req: Request, state: Pick<ServerSession, "observationSets">): Promise<Response> {
  const parsed = await parseJsonBody(req, ObservationSetCreateBodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    return Response.json(ObservationSetSchema.parse(await state.observationSets.create(parsed.data.rowIndices)));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      {
        status: error instanceof UnknownObservationRows ? 400 : 500,
      },
    );
  }
}
