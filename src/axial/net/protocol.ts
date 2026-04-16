/**
 * Axial WebSocket Protocol — typed, binary-native, multiplexed.
 *
 * Design:
 * - Single WS connection, multiplexed channels via message IDs
 * - Text frames for control (JSON), binary frames for Arrow data
 * - Request/response via Promise.withResolvers()
 * - Streaming via AsyncGenerator
 * - Fully typed with Protocol map generic
 *
 * Message format:
 *   Text frame:  JSON { _id: number, _type: string, _ch?: "data"|"end"|"error", ...payload }
 *   Binary frame: 4-byte _id (uint32 LE) + Arrow IPC payload
 */

// ---------------------------------------------------------------------------
// Protocol definition — maps message types to req/res shapes
// ---------------------------------------------------------------------------

export interface ProtocolMap {
  [method: string]: {
    req: unknown;
    res: unknown;
    stream?: boolean; // true = response is streamed as multiple binary chunks
  };
}

/** Extract request type for a method. */
export type ReqOf<P extends ProtocolMap, M extends keyof P> = P[M]["req"];

/** Extract response type for a method. */
export type ResOf<P extends ProtocolMap, M extends keyof P> = P[M]["res"];

// ---------------------------------------------------------------------------
// Frame encoding/decoding
// ---------------------------------------------------------------------------

const HEADER_SIZE = 4; // uint32 LE for message ID in binary frames

/** Encode a binary frame: 4-byte ID header + payload. */
export function encodeBinaryFrame(id: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, id, true);
  frame.set(payload, HEADER_SIZE);
  return frame;
}

/** Decode a binary frame: extract ID and payload. */
export function decodeBinaryFrame(frame: Uint8Array): { id: number; payload: Uint8Array } {
  const id = new DataView(frame.buffer, frame.byteOffset).getUint32(0, true);
  const payload = frame.subarray(HEADER_SIZE);
  return { id, payload };
}

/** JSON control message shape. */
export interface ControlMessage {
  _id: number;
  _type: string;
  _ch?: "data" | "end" | "error";
  _error?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Pending request tracker
// ---------------------------------------------------------------------------

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  stream?: {
    push: (chunk: Uint8Array) => void;
    end: () => void;
    error: (err: Error) => void;
  };
}

/** Tracks in-flight requests. Used by both client and server. */
export class RequestTracker {
  private pending = new Map<number, PendingRequest>();
  private nextId = 0;

  allocate<T>(): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, { resolve, reject } as PendingRequest);
    return { id, promise };
  }

  allocateStream(): {
    id: number;
    iterator: AsyncGenerator<Uint8Array, void, unknown>;
  } {
    const id = this.nextId++;
    let resolve: ((value: IteratorResult<Uint8Array, void>) => void) | null = null;
    const buffer: Uint8Array[] = [];
    let done = false;
    let error: Error | null = null;

    const stream: PendingRequest["stream"] = {
      push(chunk: Uint8Array) {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: chunk, done: false });
        } else {
          buffer.push(chunk);
        }
      },
      end() {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as any, done: true });
        }
      },
      error(err: Error) {
        error = err;
        done = true;
        buffer.length = 0;
        if (resolve) {
          const r = resolve;
          resolve = null;
          // Can't reject from here — push a sentinel
          r({ value: undefined as any, done: true });
        }
      },
    };

    this.pending.set(id, { resolve: () => {}, reject: () => {}, stream });

    async function* iterator(): AsyncGenerator<Uint8Array, void, unknown> {
      while (true) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (done) {
          if (error) throw error;
          return;
        }
        // Wait for next chunk
        const result = await new Promise<IteratorResult<Uint8Array, void>>((r) => {
          resolve = r;
        });
        if (result.done) {
          if (error) throw error;
          return;
        }
        yield result.value;
      }
    }

    return { id, iterator: iterator() };
  }

  resolveJson(id: number, data: unknown): void {
    const req = this.pending.get(id);
    if (!req) {
      console.warn(`[axial] resolveJson: unknown request id ${id}`);
      return;
    }
    this.pending.delete(id);
    req.resolve(data);
  }

  resolveBinary(id: number, payload: Uint8Array): void {
    const req = this.pending.get(id);
    if (!req) {
      console.warn(`[axial] resolveBinary: unknown request id ${id}`);
      return;
    }

    if (req.stream) {
      req.stream.push(payload);
    } else {
      // Single binary response
      this.pending.delete(id);
      req.resolve(payload);
    }
  }

  resolveStreamEnd(id: number): void {
    const req = this.pending.get(id);
    if (!req) {
      console.warn(`[axial] resolveStreamEnd: unknown request id ${id}`);
      return;
    }
    if (req.stream) {
      this.pending.delete(id);
      req.stream.end();
    }
  }

  reject(id: number, error: string): void {
    const req = this.pending.get(id);
    if (!req) {
      console.warn(`[axial] reject: unknown request id ${id}`);
      return;
    }
    this.pending.delete(id);
    if (req.stream) {
      req.stream.error(new Error(error));
    } else {
      req.reject(new Error(error));
    }
  }

  rejectAll(error: string): void {
    for (const [_id, req] of this.pending) {
      if (req.stream) {
        req.stream.error(new Error(error));
      } else {
        req.reject(new Error(error));
      }
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
