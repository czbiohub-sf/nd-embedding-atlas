/**
 * CropPool: persistent Bun Worker pool for OME-Zarr crop rendering.
 *
 * Mirrors the column-worker pool pattern in src/zarr/readers.ts:241+.
 * One pool per server, lifetime = server lifetime. Workers persist their
 * zarr Array LRU + WebP WASM init across tasks.
 *
 * The unit of work is a **FOV-group task** (Phase 2.5): one FOV, N obs
 * requests sharing channel state. The worker opens the FOV once, decompresses
 * shared chunks once, and streams individual crop results back via a
 * caller-supplied onResult callback as each is encoded.
 *
 * Single REST crops use a 1-request group; the WS streaming endpoint
 * (Phase 3) will pre-group crops by FOV and dispatch the same task shape.
 */

import type { PlateMount } from "./plate.ts";
import { cropWorkerUrl } from "./crop-worker-path.ts";

/** Resolve which plate mount hosts this crop, given (optional) dataset_key. */
function resolveMount(mounts: readonly PlateMount[], datasetKey?: string): PlateMount | null {
  if (mounts.length === 0) return null;
  if (!datasetKey) return mounts[0];
  return mounts.find((m) => m.datasetKey === datasetKey) ?? null;
}

const POOL_SIZE = Math.min(navigator.hardwareConcurrency ?? 4, 8);

/** Per-task input, addressed to a single FOV. */
export interface FovGroupRequest {
  mountPath: string;
  fovPath: string;
  quality: number;
  size: number;
  half: number;
  channels: { visible: boolean; lo: number; hi: number; color: string; blend?: string }[];
  requests: { rowIndex: number; t: number; z: number; x: number; y: number }[];
}

export interface CropFrame {
  rowIndex: number;
  bytes: Uint8Array;
  /** Rendered crop dimensions (aspect-preserving; `size` is the longest edge). */
  width: number;
  height: number;
}

export interface FovGroupResult {
  errors: { rowIndex: number; message: string }[];
}

interface PendingTask {
  taskId: number;
  onResult: (frame: CropFrame) => void;
  resolve: (result: FovGroupResult) => void;
  reject: (err: Error) => void;
  request: FovGroupRequest;
}

interface InboundMessage {
  taskId: number;
  rowIndex?: number;
  bytes?: Uint8Array;
  width?: number;
  height?: number;
  done?: boolean;
  errors?: { rowIndex: number; message: string }[];
  error?: string;
}

export class CropPool {
  private readonly mounts: readonly PlateMount[];
  private workers: Worker[] = [];
  private busy = new Set<number>();
  private dead = new Set<number>();
  private pending = new Map<number, PendingTask>();
  private queue: PendingTask[] = [];
  private nextId = 0;
  private disposed = false;

  constructor(mounts: readonly PlateMount[]) {
    this.mounts = mounts;
    const url = cropWorkerUrl();
    for (let i = 0; i < POOL_SIZE; i++) {
      const idx = i;
      const worker = new Worker(url, { smol: true });
      worker.addEventListener("message", (event: MessageEvent<InboundMessage>) => {
        this.handleMessage(idx, event.data);
      });
      worker.addEventListener("error", (event) => {
        this.handleWorkerError(idx, event.message ?? "unknown");
      });
      this.workers.push(worker);
    }
  }

  /**
   * Dispatch a single-FOV task. Crop results stream through `onResult`
   * as each is encoded; the returned promise resolves once the worker
   * sends its terminal `done` frame, with any per-crop errors collected.
   */
  dispatch(request: FovGroupRequest, onResult: (frame: CropFrame) => void): Promise<FovGroupResult> {
    if (this.disposed) return Promise.reject(new Error("CropPool disposed"));
    return new Promise((resolve, reject) => {
      const task: PendingTask = {
        taskId: this.nextId++,
        onResult,
        resolve,
        reject,
        request,
      };
      this.queue.push(task);
      this.dispatchNext();
    });
  }

  /**
   * Render a single crop via a 1-request group: used by the REST endpoint.
   * Resolves with the WebP bytes once that crop is done.
   */
  renderOne(
    fovPath: string,
    datasetKey: string | undefined,
    t: number,
    z: number,
    x: number,
    y: number,
    half: number,
    size: number,
    quality: number,
    channels: { visible: boolean; lo: number; hi: number; color: string }[],
  ): Promise<CropFrame> {
    const mount = resolveMount(this.mounts, datasetKey);
    if (!mount) return Promise.reject(new Error("No plate mount available for crop"));

    let captured: CropFrame | null = null;
    return new Promise((resolve, reject) => {
      this.dispatch(
        {
          mountPath: mount.diskPath,
          fovPath,
          quality,
          size,
          half,
          channels,
          requests: [{ rowIndex: 0, t, z, x, y }],
        },
        (frame) => {
          captured = frame;
        },
      ).then(
        (result) => {
          if (captured) {
            resolve(captured);
          } else {
            const err = result.errors[0];
            reject(new Error(err?.message ?? "Crop produced no result"));
          }
        },
        (err: unknown) => {
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const worker of this.workers) {
      worker.terminate();
    }
    const err = new Error("CropPool disposed");
    for (const task of this.pending.values()) task.reject(err);
    for (const task of this.queue) task.reject(err);
    this.pending.clear();
    this.queue.length = 0;
  }

  // ── internals ──────────────────────────────────────────────────────────

  private handleMessage(workerIdx: number, msg: InboundMessage): void {
    const task = this.pending.get(msg.taskId);
    if (!task) return; // stale or aborted

    if (msg.error) {
      this.pending.delete(msg.taskId);
      this.busy.delete(workerIdx);
      task.reject(new Error(msg.error));
      this.dispatchNext();
      return;
    }

    if (msg.done) {
      this.pending.delete(msg.taskId);
      this.busy.delete(workerIdx);
      task.resolve({ errors: msg.errors ?? [] });
      this.dispatchNext();
      return;
    }

    // Per-crop result frame.
    if (msg.bytes && msg.rowIndex !== undefined) {
      try {
        task.onResult({ rowIndex: msg.rowIndex, bytes: msg.bytes, width: msg.width ?? 0, height: msg.height ?? 0 });
      } catch (err) {
        console.error(`[crop-pool] onResult callback threw:`, err);
      }
    }
  }

  private handleWorkerError(workerIdx: number, message: string): void {
    this.busy.delete(workerIdx);
    this.dead.add(workerIdx);
    const err = new Error(`Crop worker ${workerIdx} failed: ${message}`);
    // Reject every pending task that was on this worker. We don't know
    // exactly which (we don't track worker→task), so reject all in flight.
    for (const task of this.pending.values()) task.reject(err);
    this.pending.clear();
    for (const task of this.queue) task.reject(err);
    this.queue.length = 0;
  }

  private findIdleWorker(): number {
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.busy.has(i) && !this.dead.has(i)) return i;
    }
    return -1;
  }

  private dispatchNext(): void {
    while (this.queue.length > 0) {
      const idx = this.findIdleWorker();
      if (idx === -1) break;
      const task = this.queue.shift()!;
      this.busy.add(idx);
      this.pending.set(task.taskId, task);
      this.workers[idx].postMessage({
        taskId: task.taskId,
        ...task.request,
      });
    }
  }
}
