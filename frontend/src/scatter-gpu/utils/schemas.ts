/**
 * Zod schemas for binary blob headers from scatter endpoints.
 *
 * Validates immediately after JSON.parse to catch Python/TS contract breaks
 * at the data boundary with descriptive field-level errors, rather than
 * propagating as NaN values or crashes deep in the GPU pipeline.
 */
import { z } from "zod";

export const PositionHeaderSchema = z.object({
    numCells: z.number().int().positive(),
    embeddingKey: z.string().min(1),
    ndim: z.literal(2),
    rowIndices: z.array(z.number().int().nonnegative()),
    positionScale: z.number().positive().default(1),
});

export const CategoryHeaderSchema = z.object({
    categoryNames: z.array(z.string()),
});

export const ContinuousColorsHeaderSchema = z.object({
    numPoints: z.number().int().positive(),
    vmin: z.number(),
    vmax: z.number(),
    colormap: z.string().min(1),
});

export type PositionHeader = z.infer<typeof PositionHeaderSchema>;
export type CategoryHeader = z.infer<typeof CategoryHeaderSchema>;
export type ContinuousColorsHeader = z.infer<typeof ContinuousColorsHeaderSchema>;
