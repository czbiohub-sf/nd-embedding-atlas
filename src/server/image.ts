/**
 * Minimal zero-dependency PNG encoder + channel compositor.
 *
 * PNG output uses 8-bit RGBA; IDAT is produced with `Bun.deflateSync` which
 * emits a valid zlib stream.
 */

// ─── CRC32 (PNG chunk checksum) ─────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ─── PNG primitives ─────────────────────────────────────────────────────────

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, false); // big-endian
}

function buildChunk(typeCode: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const out = new Uint8Array(8 + len + 4);
  const view = new DataView(out.buffer);
  writeU32(view, 0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = typeCode.charCodeAt(i);
  out.set(data, 8);
  // CRC over type + data (not length)
  const crcBuf = out.subarray(4, 8 + len);
  writeU32(view, 8 + len, crc32(crcBuf));
  return out;
}

/**
 * Encode raw RGBA8 pixels (length = width*height*4) as a PNG.
 */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePng: expected ${width * height * 4} bytes, got ${rgba.length}`);
  }

  // IHDR: width, height, bit_depth=8, color_type=6 (RGBA), compression=0, filter=0, interlace=0
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  writeU32(ihdrView, 0, width);
  writeU32(ihdrView, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // IDAT: prepend filter byte (0 = None) to each row, deflate
  const rowBytes = width * 4;
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter type
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const idat = Bun.deflateSync(raw);

  const ihdrChunk = buildChunk("IHDR", ihdr);
  const idatChunk = buildChunk("IDAT", new Uint8Array(idat));
  const iendChunk = buildChunk("IEND", new Uint8Array(0));

  const total = PNG_SIG.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(PNG_SIG, off);
  off += PNG_SIG.length;
  out.set(ihdrChunk, off);
  off += ihdrChunk.length;
  out.set(idatChunk, off);
  off += idatChunk.length;
  out.set(iendChunk, off);
  return out;
}

// ─── Channel compositing ────────────────────────────────────────────────────

export interface ChannelRequest {
  /** Index into the C axis of the zarr array. */
  cIndex: number;
  /** Whether to include this channel in the composite. */
  visible: boolean;
  /** Low end of the intensity window (mapped to 0). */
  lo: number;
  /** High end of the intensity window (mapped to 255). */
  hi: number;
  /** Hex color without '#', e.g. "FF0000". Applied multiplicatively. */
  color: string;
}

/**
 * Composite `channels` into an RGBA8 buffer.
 *
 * Each channel slab is `srcW × srcH` float32 pixel intensities (one channel's
 * 2D slice). Visible channels are windowed to [0, 1], multiplied by the
 * channel's color, and additively blended into the output. The alpha byte is
 * always 255.
 *
 * Output is optionally nearest-neighbour resampled to dstW × dstH.
 */
export function compositeChannels(
  slabs: Float32Array[],
  channels: readonly ChannelRequest[],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (slabs.length !== channels.length) {
    throw new Error(`compositeChannels: slabs.length=${slabs.length} != channels.length=${channels.length}`);
  }

  const srcRGB = new Float32Array(srcW * srcH * 3);
  for (let k = 0; k < channels.length; k++) {
    const ch = channels[k];
    if (!ch.visible) continue;
    const [r, g, b] = hexToRgbFloat(ch.color);
    const span = ch.hi - ch.lo;
    const invSpan = span !== 0 ? 1 / span : 0;
    const slab = slabs[k];
    for (let i = 0; i < slab.length; i++) {
      const v = (slab[i] - ch.lo) * invSpan;
      const c = v < 0 ? 0 : v > 1 ? 1 : v;
      srcRGB[i * 3] += c * r;
      srcRGB[i * 3 + 1] += c * g;
      srcRGB[i * 3 + 2] += c * b;
    }
  }

  const out = new Uint8Array(dstW * dstH * 4);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const ySrc = Math.min(srcH - 1, Math.floor(y * yRatio));
    for (let x = 0; x < dstW; x++) {
      const xSrc = Math.min(srcW - 1, Math.floor(x * xRatio));
      const srcIdx = (ySrc * srcW + xSrc) * 3;
      const dstIdx = (y * dstW + x) * 4;
      out[dstIdx] = clamp255(srcRGB[srcIdx]);
      out[dstIdx + 1] = clamp255(srcRGB[srcIdx + 1]);
      out[dstIdx + 2] = clamp255(srcRGB[srcIdx + 2]);
      out[dstIdx + 3] = 255;
    }
  }
  return out;
}

function clamp255(v: number): number {
  const n = Math.round(v * 255);
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function hexToRgbFloat(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "").padStart(6, "0");
  const n = Number.parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
