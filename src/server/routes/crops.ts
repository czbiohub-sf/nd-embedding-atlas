/**
 * Image crop endpoint.
 *
 * POST /api/crop/{fov_path}
 *   body: { t, z, x, y, half, size?, quality?, dataset_key?, channels: [...] }
 *
 * Always returns WebP. Quality defaults to 78 (gallery thumb sweet spot —
 * the WebP encoder's "fast encode" zone (q<80) gives ≈10–15% smaller bytes
 * than q=90 with no visible difference at 200px). Single-obs viewer can
 * override with `quality: 90` for full-fidelity inspection.
 *
 * Rendering is dispatched into the Bun Worker pool (`state.cropPool`),
 * keeping zarr decompression + RGBA composite + WebP encode off the main
 * event loop. WS streaming (Phase 3) reuses the same pool.
 */

import { CropBodySchema, parseJsonBody } from "../protocol.ts";
import type { ViewerState } from "../state.ts";

const DEFAULT_QUALITY = 78;
const DEFAULT_HALF = 150;

export async function handleCrop(fovPath: string, req: Request, state: ViewerState): Promise<Response> {
  if (req.method !== "POST") {
    return Response.json({ error: "Only POST is supported" }, { status: 405 });
  }

  const parsed = await parseJsonBody(req, CropBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const t = body.t ?? 0;
  const z = body.z ?? 0;
  const x = body.x;
  const y = body.y;
  const half = body.half ?? DEFAULT_HALF;

  if (x == null || y == null) {
    return Response.json({ error: "Missing required fields: x, y" }, { status: 400 });
  }

  if (state.plateMounts.length === 0 || !state.cropPool) {
    return Response.json({ error: "No plate configured" }, { status: 400 });
  }

  const quality = body.quality ?? DEFAULT_QUALITY;
  const size = body.size ?? 2 * half;
  const channels = (body.channels ?? []).map((ch) => ({
    visible: ch.visible ?? true,
    lo: ch.lo ?? 0,
    hi: ch.hi ?? 1,
    color: ch.color ?? "FFFFFF",
  }));

  try {
    const bytes = await state.cropPool.renderOne(
      decodeURIComponent(fovPath),
      body.dataset_key,
      t,
      z,
      x,
      y,
      half,
      size,
      quality,
      channels,
    );

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[crop] ${msg}`);
    return Response.json({ error: msg }, { status: 500 });
  }
}
