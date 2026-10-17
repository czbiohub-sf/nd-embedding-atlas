import { ObservationSetCreateBodySchema, ObservationSetSchema } from "@ndea/protocol";
import { rowWords, UnknownObservationRows } from "../observation-sets.ts";
import { parseJsonBody } from "../protocol.ts";
import type { ServerSession } from "../state.ts";

/** JSON `{ rowIndices }`, or an `application/octet-stream` row bitmask with `?rows=<nObs>`. */
export async function handleSetsPost(
  req: Request,
  state: Pick<ServerSession, "observationSets" | "store">,
): Promise<Response> {
  let words: Uint32Array;
  if (req.headers.get("content-type")?.startsWith("application/octet-stream")) {
    const rows = Number(new URL(req.url).searchParams.get("rows"));
    const bytes = Math.ceil(state.store.nObs / 8);
    const body = new Uint8Array(await req.arrayBuffer());
    if (rows !== state.store.nObs || body.byteLength !== bytes) {
      return Response.json(
        {
          error: `bitmask must cover all ${state.store.nObs} rows in ${bytes} bytes (got rows=${rows}, ${body.byteLength} bytes)`,
        },
        { status: 400 },
      );
    }
    words = new Uint32Array(Math.ceil(rows / 32));
    new Uint8Array(words.buffer).set(body);
  } else {
    const parsed = await parseJsonBody(req, ObservationSetCreateBodySchema);
    if (!parsed.ok) return parsed.response;
    words = rowWords(parsed.data.rowIndices);
  }
  try {
    return Response.json(ObservationSetSchema.parse(await state.observationSets.create(words)));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      {
        status: error instanceof UnknownObservationRows ? 400 : 500,
      },
    );
  }
}
