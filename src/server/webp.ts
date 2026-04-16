/**
 * WebP encoder wrapper around @jsquash/webp.
 *
 * Loads the Emscripten WASM once on first call and reuses the instance.
 * Embedding both SIMD and non-SIMD wasm lets `bun build --compile` ship
 * them inside `$bunfs/`; at runtime we pick whichever matches the host.
 */

import encodeWebp, { init as initWebpEncode } from "@jsquash/webp/encode";
import { simd } from "wasm-feature-detect";
import wasmPath from "@jsquash/webp/codec/enc/webp_enc.wasm" with { type: "file" };
import wasmSimdPath from "@jsquash/webp/codec/enc/webp_enc_simd.wasm" with { type: "file" };

let ready: Promise<void> | null = null;

async function ensureWebp(): Promise<void> {
    if (ready) return ready;
    ready = (async () => {
        const useSimd = await simd();
        const bytes = await Bun.file(useSimd ? wasmSimdPath : wasmPath).arrayBuffer();
        const mod = await WebAssembly.compile(bytes);
        await initWebpEncode(mod);
    })();
    return ready;
}

/**
 * Encode RGBA pixels to WebP. Expects `rgba.length === 4 * width * height`.
 * Defaults to quality 90 (visually near-lossless for microscopy crops).
 */
export async function encodeWebpImage(
    rgba: Uint8Array,
    width: number,
    height: number,
    quality: number = 90,
): Promise<Uint8Array> {
    await ensureWebp();
    const clamped = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const imageData = {
        data: clamped,
        width,
        height,
        colorSpace: "srgb",
    } as unknown as ImageData;
    const buf = await encodeWebp(imageData, { quality });
    return new Uint8Array(buf);
}
