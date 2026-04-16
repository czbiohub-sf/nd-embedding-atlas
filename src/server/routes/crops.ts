/**
 * Image crop endpoint.
 *
 * POST /api/crop/{fov_path}
 *   body: { t, z, x, y, half, size?, fmt?, dataset_key?, channels: [...] }
 *
 * Returns a composited PNG of the requested region. The `fmt` field is
 * accepted for forward compatibility (the browser treats the blob URL as
 * whatever the Content-Type says), but only PNG is implemented currently.
 */

import { renderCropPng } from "../crop.ts";
import type { ViewerState } from "../state.ts";

interface CropBody {
    t?: number;
    z?: number;
    x?: number;
    y?: number;
    half?: number;
    size?: number;
    fmt?: string;
    dataset_key?: string;
    channels?: Array<{
        visible?: boolean;
        lo?: number;
        hi?: number;
        color?: string;
    }>;
}

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

    let body: CropBody;
    try {
        body = (await req.json()) as CropBody;
    } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

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

    try {
        const png = await renderCropPng(
            {
                fovPath: decodeURIComponent(fovPath),
                datasetKey: body.dataset_key,
                t,
                z,
                x,
                y,
                half,
                size: body.size,
                channels: (body.channels ?? []).map((ch) => ({
                    visible: ch.visible ?? true,
                    lo: ch.lo ?? 0,
                    hi: ch.hi ?? 1,
                    color: ch.color ?? "FFFFFF",
                })),
            },
            state.plateMounts,
        );

        return new Response(png as unknown as BodyInit, {
            headers: {
                "Content-Type": "image/png",
                "Cache-Control": "public, max-age=300",
            },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[crop] ${msg}`);
        return Response.json({ error: msg }, { status: 500 });
    }
}
