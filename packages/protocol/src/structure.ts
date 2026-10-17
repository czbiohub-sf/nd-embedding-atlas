/** GET /api/status/datasets/:name/structure: the experimental structure view (apps/ndea/src/cli/tui-structure.ts). */

import { z } from "zod";

const count = z.number().int().nonnegative();
const shape = z.array(count);
const keyed = z.array(z.object({ key: z.string(), shape }));
const frame = z.object({ count, columns: z.array(z.object({ name: z.string(), dtype: z.string() })) });

export const DatasetStructureSchema = z.object({
  name: z.string(),
  /** MuData: the modality shown (the first). */
  modality: z.string().optional(),
  anndata: z.object({
    X: z.object({ shape, dtype: z.string() }).nullable(),
    obs: frame,
    var: frame,
    obsm: keyed,
    varm: keyed,
    obsp: keyed,
    varp: keyed,
    layers: keyed,
    uns: count,
  }),
  plate: z
    .object({
      rows: z.array(z.string()),
      columns: z.array(z.string()),
      wells: z.array(z.object({ row: count, col: count, fovs: count })),
      channels: z.array(z.object({ name: z.string(), color: z.string() })), // color: "#RRGGBB"
      /** The first FOV's full-resolution array; `axes` like "TCZYX". */
      image: z.object({ axes: z.string(), shape, dtype: z.string() }).nullable(),
    })
    .optional(),
});
export type DatasetStructure = z.infer<typeof DatasetStructureSchema>;
