/**
 * Image crop endpoint — stub.
 *
 * GET  /api/crop/{fov_path} — Composited RGB crop from zarr (startup defaults)
 * POST /api/crop/{fov_path} — Composited RGB crop with live channel config
 *
 * TODO: Wire up zarr reading via axial I/O + sharp/canvas for image composition.
 * Currently returns 501 Not Implemented.
 */

/**
 * Handle GET/POST /api/crop/{fov_path}
 *
 * Returns a composited WebP/PNG image for a single FOV timepoint.
 * Not yet implemented in the Bun backend — requires zarr I/O integration.
 */
export function handleCrop(_fovPath: string, _req: Request): Response {
    return Response.json(
        {
            error: "Image crop endpoint not yet implemented in Bun backend. " +
                "Requires zarr I/O integration for reading plate data.",
        },
        { status: 501 },
    );
}
