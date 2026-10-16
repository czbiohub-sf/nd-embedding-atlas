/**
 * Binary protocol parsers for scatter-positions, scatter-categories, and
 * scatter-continuous-colors endpoints.
 *
 * Binary layout (all endpoints):
 *   Byte 0:        version (uint8): must be 1
 *   Bytes 1–4:     header_len (uint32 little-endian)
 *   Bytes 5–(5+header_len-1): JSON header (UTF-8)
 *   Padding:       align to 4 bytes from byte 0
 *   Data:          Float32Array (positions/rgba) or Uint8Array (categories)
 */
import {
  type CategoryHeader,
  CategoryHeaderSchema,
  type ContinuousValuesHeader,
  ContinuousValuesHeaderSchema,
  type PositionHeader,
  PositionHeaderSchema,
} from "@ndea/protocol";

/** Parsed result from /api/scatter-positions */
export interface PositionBlob {
  header: PositionHeader;
  positions: Float32Array;
}

/** Parsed result from /api/scatter-categories */
export interface CategoryBlob {
  header: CategoryHeader;
  categoryIndices: Uint8Array;
}

/** Parsed result from /api/scatter-continuous-values (Phase 7+). */
export interface ContinuousValuesBlob {
  header: ContinuousValuesHeader;
  /** Raw values, length = numPoints. NaNs preserved; GPU kernel handles them. */
  values: Float32Array;
}

/** Shared binary framing logic: reads version byte, returns aligned data offset. */
function parseFrame(buf: ArrayBuffer, label: string, expectedVersion = 1): { header: unknown; dataOffset: number } {
  const view = new DataView(buf);
  const version = view.getUint8(0);
  if (version !== expectedVersion) {
    throw new Error(`Unsupported ${label} format v${version} (expected ${expectedVersion})`);
  }
  const headerLen = view.getUint32(1, true);
  const headerBytes = new Uint8Array(buf, 5, headerLen);
  const header: unknown = JSON.parse(new TextDecoder().decode(headerBytes));
  const rawDataOffset = 5 + headerLen;
  const dataOffset = Math.ceil(rawDataOffset / 4) * 4;
  return { header, dataOffset };
}

/**
 * Parse the binary position blob returned by /api/scatter-positions.
 * Validates the JSON header with Zod: throws a descriptive ZodError if
 * the Python endpoint changes field names or types.
 */
export function parsePositionBlob(buf: ArrayBuffer): PositionBlob {
  const { header: rawHeader, dataOffset } = parseFrame(buf, "scatter-positions");
  const header = PositionHeaderSchema.parse(rawHeader);
  const positions = new Float32Array(buf, dataOffset);
  return { header, positions };
}

/**
 * Parse the binary category blob returned by /api/scatter-categories.
 */
export function parseCategoryBlob(buf: ArrayBuffer): CategoryBlob {
  const { header: rawHeader, dataOffset } = parseFrame(buf, "scatter-categories");
  const header = CategoryHeaderSchema.parse(rawHeader);
  const categoryIndices = new Uint8Array(buf, dataOffset);
  return { header, categoryIndices };
}

/**
 * Parse the binary continuous-values blob returned by /api/scatter-continuous-values.
 *
 * The Float32Array payload must be 4-byte aligned; parseFrame already pads
 * dataOffset to a 4-byte boundary but we assert it explicitly to catch a
 * future framing change that silently breaks f32 alignment (RangeError on
 * some engines, garbage reads on others).
 */
export function parseContinuousValuesBlob(buf: ArrayBuffer): ContinuousValuesBlob {
  const { header: rawHeader, dataOffset } = parseFrame(buf, "scatter-continuous-values", 2);
  const header = ContinuousValuesHeaderSchema.parse(rawHeader);
  if (dataOffset % 4 !== 0) {
    throw new Error(`scatter-continuous-values: dataOffset ${dataOffset} not 4-byte aligned`);
  }
  const values = new Float32Array(buf, dataOffset, header.numPoints);
  return { header, values };
}
