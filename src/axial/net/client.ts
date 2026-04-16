/**
 * Axial WebSocket Client — typed, binary-native.
 *
 * Usage:
 *   const client = new AxialClient<MyProtocol>("ws://localhost:3000");
 *   await client.connected;
 *
 *   const meta = await client.call("meta", {});
 *   for await (const chunk of client.stream("x", { obs: [1,2,3] })) { ... }
 *
 *   client.close();
 */

import type { ControlMessage, ProtocolMap, ReqOf, ResOf } from "./protocol.ts";
import { decodeBinaryFrame, RequestTracker } from "./protocol.ts";

export class AxialClient<P extends ProtocolMap> implements AsyncDisposable {
  private ws: WebSocket;
  private tracker = new RequestTracker();
  private _connected: Promise<void>;
  private _closed: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this._connected = new Promise<void>((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket connect failed"));
    });

    this._closed = new Promise<void>((resolve) => {
      this.ws.onclose = () => {
        this.tracker.rejectAll("WebSocket closed");
        resolve();
      };
    });

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const { id, payload } = decodeBinaryFrame(new Uint8Array(event.data));
        this.tracker.resolveBinary(id, payload);
      } else {
        const msg = JSON.parse(event.data as string) as ControlMessage;
        if (msg._ch === "end") {
          this.tracker.resolveStreamEnd(msg._id);
        } else if (msg._ch === "error") {
          this.tracker.reject(msg._id, msg._error ?? "Unknown error");
        } else {
          // JSON response
          const { _id, _type, _ch, ...data } = msg;
          this.tracker.resolveJson(msg._id, data);
        }
      }
    };
  }

  /** Wait for the connection to be established. */
  get connected(): Promise<void> {
    return this._connected;
  }

  /**
   * Call a method and get a single response (JSON or binary).
   * For JSON responses, returns the parsed object.
   * For binary responses (Arrow IPC), returns Uint8Array.
   */
  async call<M extends string & keyof P>(method: M, params: ReqOf<P, M>): Promise<ResOf<P, M>> {
    await this._connected;
    const { id, promise } = this.tracker.allocate<ResOf<P, M>>();
    this.ws.send(JSON.stringify({ _id: id, _type: method, ...(params as object) }));
    return promise;
  }

  /**
   * Call a method and get a streamed response (multiple binary chunks).
   * Returns an async iterator of Uint8Array chunks.
   */
  async *stream<M extends string & keyof P>(
    method: M,
    params: ReqOf<P, M>,
  ): AsyncGenerator<Uint8Array, void, unknown> {
    await this._connected;
    const { id, iterator } = this.tracker.allocateStream();
    this.ws.send(JSON.stringify({ _id: id, _type: method, _stream: true, ...(params as object) }));
    yield* iterator;
  }

  /** Number of in-flight requests. */
  get pending(): number {
    return this.tracker.size;
  }

  /** Close the connection. */
  close(): void {
    this.ws.close();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.close();
    await this._closed;
  }
}
