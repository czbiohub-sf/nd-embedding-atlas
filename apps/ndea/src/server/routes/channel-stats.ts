/**
 * Channel-stats endpoint.
 *
 * GET /api/channel-stats/{fov_path}?dataset_key=
 *   → { channels: [{ lo, hi, dataMin, dataMax, bins }] }
 *
 * Per-channel pixel statistics for autocontrast, computed from the coarsest
 * pyramid level and server-cached (see channel-stats.ts). Tiny JSON; the
 * frontend fetches it once per FOV and derives display limits from the
 * selected method (percentile vs min–max) without re-fetching.
 */

import { computeChannelStats } from "../channel-stats.ts";
import type { PlateMount } from "../plate.ts";
import type { ServerSession } from "../state.ts";

/** Resolve which plate mount hosts this FOV, given an optional dataset_key. */
function resolveMount(mounts: readonly PlateMount[], datasetKey: string | null): PlateMount | null {
  if (mounts.length === 0) return null;
  if (!datasetKey) return mounts[0];
  return mounts.find((m) => m.datasetKey === datasetKey) ?? null;
}

export async function handleChannelStats(fovPath: string, req: Request, state: ServerSession): Promise<Response> {
  if (req.method !== "GET") {
    return Response.json({ error: "Only GET is supported" }, { status: 405 });
  }

  const datasetKey = new URL(req.url).searchParams.get("dataset_key");
  const mount = resolveMount(state.plateMounts, datasetKey);
  if (!mount) {
    return Response.json({ error: "No plate mount available" }, { status: 400 });
  }

  try {
    const channels = await computeChannelStats(mount.diskPath, decodeURIComponent(fovPath));
    return Response.json({ channels }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[channel-stats] ${msg}`);
    return Response.json({ error: msg }, { status: 500 });
  }
}
