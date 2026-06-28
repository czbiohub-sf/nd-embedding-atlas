/**
 * HTTP protocol layer for the ndea server.
 *
 * Schemas + types live in `@ndea/protocol` (shared with the frontend).
 * This module keeps server-only concerns: the `parseJsonBody` helper that
 * turns a Zod schema into a 400-producing Response guard, plus re-exports
 * so route handlers only need a single import.
 */

import type { z } from "zod";

export {
  ActiveSelectionResponseSchema,
  AnnotationColumnBodySchema,
  AnnotationExportBodySchema,
  CommitAnnotationsBodySchema,
  AppendMembersBodySchema,
  CategorizeBodySchema,
  CollectionMemberSchema,
  CollectionMutationResultSchema,
  CollectionNameSchema,
  CollectionSchema,
  CreateCollectionBodySchema,
  CropBodySchema,
  CropChannelSchema,
  ExportBodySchema,
  MemberMutationStatsSchema,
  VarColumnBodySchema,
  MosaicQueryBodySchema,
  PatchCollectionBodySchema,
  ScatterSelectionBodySchema,
  SetActiveSelectionBodySchema,
  WriteAnnotationValuesBodySchema,
} from "../protocol/index.ts";
export type {
  ActiveSelectionResponse,
  AnnotationColumnBody,
  AnnotationDtype,
  AnnotationValueRow,
  AppendMembersBody,
  WriteAnnotationValuesBody,
  CategorizeBody,
  CategorizeResponse,
  CategoryLegendItem,
  Collection,
  CollectionDrift,
  CollectionMember,
  CollectionMutationResult,
  ConfigRes,
  CreateCollectionBody,
  CropBody,
  EmbeddingStatus,
  ExportBody,
  MemberMutationStats,
  VarColumnBody,
  Metadata,
  MosaicQueryBody,
  MosaicQueryReq,
  NdeaProtocol,
  ObsInfo,
  PatchCollectionBody,
  ProtocolMap,
  ScatterSelectionBody,
  SetActiveSelectionBody,
} from "../protocol/index.ts";

/**
 * Parse and validate a JSON request body against a Zod schema.
 *
 * Returns a discriminated result:
 *   - `{ ok: true, data }`     — payload parsed successfully
 *   - `{ ok: false, response }` — 400 Response with `{ error, issues }`
 *
 * Usage:
 *   const parsed = await parseJsonBody(req, CropBodySchema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data;
 */
export async function parseJsonBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: Response.json(
        { error: "Request body failed validation", issues: result.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}
