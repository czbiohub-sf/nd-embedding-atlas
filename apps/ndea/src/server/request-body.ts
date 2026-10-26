/**
 * The request conventions: every route parses its JSON body with `parseBody`,
 * and a malformed one answers 400 with an RFC 9457 problem (`Problem` in
 * `@ndea/protocol`) whose `errors` name JSON Pointers into the body. An
 * unexpected failure answers `routeError`.
 */

import type { Problem } from "@ndea/protocol";
import type { z } from "zod";

/** A 400 `application/problem+json` response. */
export function problem(detail: string, errors: Problem["errors"] = [], title = "Invalid request body"): Response {
  const body: Problem = { type: "about:blank", title, status: 400, detail, errors };
  return Response.json(body, { status: 400, headers: { "content-type": "application/problem+json" } });
}

/** A route's unexpected failure: 499 when the client went away, else logged under `[tag]` and a 500 `{ error }`. */
export function routeError(tag: string, err: unknown, signal?: AbortSignal): Response {
  if (signal?.aborted) return new Response("aborted", { status: 499 });
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${tag}] ${message}`);
  return Response.json({ error: message }, { status: 500 });
}

/** `text` parsed as JSON (empty reads as `{}`) and validated by `schema`, or a 400 problem response. */
export function parseJson<T>(text: string, schema: z.ZodType<T>): T | Response {
  let raw: unknown;
  try {
    raw = text === "" ? {} : JSON.parse(text);
  } catch {
    return problem("Invalid JSON body");
  }
  const body = schema.safeParse(raw);
  if (body.success) return body.data;
  return problem(
    "Request body failed validation",
    body.error.issues.map((issue) => ({ pointer: `/${issue.path.join("/")}`, detail: issue.message })),
  );
}

/** The JSON body validated by `schema` (an empty body reads as `{}`), or a 400 problem response. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  return parseJson(await req.text(), schema);
}
