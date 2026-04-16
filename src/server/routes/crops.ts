/**
 * Image crop endpoint.
 *
 * POST /api/crop/{fov_path}
 *   body: { t, z, x, y, half, size?, fmt?, quality?, dataset_key?, channels: [...] }
 *
 * Returns a composited image of the requested region. `fmt` selects the
 * encoding — "png" (default, zero-dep) or "webp" (via @jsquash wasm).
 */

import { renderCrop, type CropFormat } from "../crop.ts";
import { CropBodySchema, parseJsonBody } from "../protocol.ts";
import type { ViewerState } from "../state.ts";

export async function handleCrop(
    fovPath: string,
    req: Request,
    state: ViewerState,
): Promise<Response> {
    if (req.method !== "POST") {
        // GET variant exists in the contract but is not exercised by the
        // current frontend; reject cleanly.
        return Response.json({ error: "Only POST is supported" }, { status: 405 });
    }

    const parsed = await parseJsonBody(req, CropBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const t = body.t ?? 0;
    const z = body.z ?? 0;
    const x = body.x;
    const y = body.y;
    const half = body.half ?? 150;

    if (x == null || y == null) {
        return Response.json({ error: "Missing required fields: x, y" }, { status: 400 });
    }

    if (state.plateMounts.length === 0) {
        return Response.json({ error: "No plate configured" }, { status: 400 });
    }

    const format: CropFormat = body.fmt === "webp" ? "webp" : "png";

    try {
        const { bytes, mime } = await renderCrop(
            {
                fovPath: decodeURIComponent(fovPath),
                datasetKey: body.dataset_key,
                t,
                z,
                x,
                y,
                half,
                size: body.size,
                format,
                quality: body.quality,
                channels: (body.channels ?? []).map((ch) => ({
                    visible: ch.visible ?? true,
                    lo: ch.lo ?? 0,
                    hi: ch.hi ?? 1,
                    color: ch.color ?? "FFFFFF",
                })),
            },
            state.plateMounts,
        );

        return new Response(bytes as unknown as BodyInit, {
            headers: {
                "Content-Type": mime,
                "Cache-Control": "public, max-age=300",
            },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[crop] ${msg}`);
        return Response.json({ error: msg }, { status: 500 });
    }
}
