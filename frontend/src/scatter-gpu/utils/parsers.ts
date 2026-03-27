/**
 * Binary protocol parsers for scatter-positions, scatter-categories, and
 * scatter-continuous-colors endpoints.
 *
 * Binary layout (all endpoints):
 *   Byte 0:        version (uint8) — must be 1
 *   Bytes 1–4:     header_len (uint32 little-endian)
 *   Bytes 5–(5+header_len-1): JSON header (UTF-8)
 *   Padding:       align to 4 bytes from byte 0
 *   Data:          Float32Array (positions/rgba) or Uint8Array (categories)
 *
 * The version byte is prepended by the Python endpoint (Wave 1B).
 * Client parsers read byte 0 as version, assert === 1, then parse from offset 1.
 */

/** Parsed result from /api/scatter-positions */
export interface PositionBlob {
  header: {
    num_points: number;
    embedding_key: string;
    x_col: string;
    y_col: string;
    row_indices: number[];
  };
  positions: Float32Array;
}

/** Parsed result from /api/scatter-categories */
export interface CategoryBlob {
  header: {
    num_points: number;
    cat_col: string;
    category_names: string[];
  };
  categoryIndices: Uint8Array;
}

/**
 * Parse the binary position blob returned by /api/scatter-positions.
 *
 * Protocol version 1:
 *   [version: u8][header_len: u32le][header: utf8][padding to 4B][float32[] positions]
 */
export function parsePositionBlob(buf: ArrayBuffer): PositionBlob {
  const view = new DataView(buf);

  // Read and validate version byte
  const version = view.getUint8(0);
  if (version !== 1) {
    throw new Error(`Unsupported scatter-positions format v${version} (expected 1)`);
  }

  // Header length is at offset 1 (4 bytes, little-endian)
  const headerLen = view.getUint32(1, true);

  // JSON header at offset 5
  const headerBytes = new Uint8Array(buf, 5, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as PositionBlob["header"];

  // Positions start after padding to next 4-byte boundary from start of buffer
  const rawDataOffset = 5 + headerLen;
  const alignedOffset = Math.ceil(rawDataOffset / 4) * 4;
  const positions = new Float32Array(buf, alignedOffset);

  return { header, positions };
}

/**
 * Parse the binary category blob returned by /api/scatter-categories.
 *
 * Protocol version 1:
 *   [version: u8][header_len: u32le][header: utf8][padding to 4B][uint8[] category_indices]
 */
export function parseCategoryBlob(buf: ArrayBuffer): CategoryBlob {
  const view = new DataView(buf);

  // Read and validate version byte
  const version = view.getUint8(0);
  if (version !== 1) {
    throw new Error(`Unsupported scatter-categories format v${version} (expected 1)`);
  }

  // Header length is at offset 1 (4 bytes, little-endian)
  const headerLen = view.getUint32(1, true);

  // JSON header at offset 5
  const headerBytes = new Uint8Array(buf, 5, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as CategoryBlob["header"];

  // Category indices start after padding to next 4-byte boundary from start of buffer
  const rawDataOffset = 5 + headerLen;
  const alignedOffset = Math.ceil(rawDataOffset / 4) * 4;
  const categoryIndices = new Uint8Array(buf, alignedOffset);

  return { header, categoryIndices };
}

/** Parsed result from /api/scatter-continuous-colors */
export interface ContinuousColorsBlob {
  header: {
    numPoints: number;
    vmin: number;
    vmax: number;
    colormap: string;
  };
  /** RGBA float32 values, length = numPoints * 4, each channel in [0, 1] */
  rgba: Float32Array;
}

/**
 * Parse the binary continuous-colors blob returned by /api/scatter-continuous-colors.
 *
 * Protocol version 1:
 *   [version: u8][header_len: u32le][header: utf8][padding to 4B][float32[] rgba]
 *
 * The JSON header contains: { numPoints, vmin, vmax, colormap }
 */
export function parseContinuousColorsBlob(buf: ArrayBuffer): ContinuousColorsBlob {
  const view = new DataView(buf);

  // Read and validate version byte
  const version = view.getUint8(0);
  if (version !== 1) {
    throw new Error(`Unsupported scatter-continuous-colors format v${version} (expected 1)`);
  }

  // Header length is at offset 1 (4 bytes, little-endian)
  const headerLen = view.getUint32(1, true);

  // JSON header at offset 5
  const headerBytes = new Uint8Array(buf, 5, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as ContinuousColorsBlob["header"];

  // RGBA data starts after padding to next 4-byte boundary from start of buffer
  const rawDataOffset = 5 + headerLen;
  const alignedOffset = Math.ceil(rawDataOffset / 4) * 4;
  const rgba = new Float32Array(buf, alignedOffset, header.numPoints * 4);

  return { header, rgba };
}
