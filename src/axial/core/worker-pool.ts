/**
 * Bun Worker Pool for parallel codec/decode operations.
 *
 * Inspired by @fideus-labs/worker-pool but native to Bun:
 * - Uses Bun's blob: URL workers (inline TypeScript, no separate file)
 * - smol: true for low memory per worker
 * - ArrayBuffer transfer for zero-copy message passing
 * - Bounded concurrency with task queue
 *
 * Usage:
 *   const pool = new WorkerPool(4);
 *   const result = await pool.submit(taskData);
 *   pool.terminate();
 *
 * Or with `using`:
 *   using pool = new WorkerPool(4);
 *   // auto-terminated at scope exit
 */

type TaskId = number;

interface PendingTask<T = unknown> {
  id: TaskId;
  data: unknown;
  transfer?: Transferable[];
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface WorkerMessage {
  id: TaskId;
  result?: unknown;
  error?: string;
  transfer?: ArrayBuffer[];
}

export interface WorkerPoolOptions {
  /** Number of workers. Defaults to navigator.hardwareConcurrency or 4. */
  size?: number;
  /** Use smol mode for lower memory per worker. Default: true. */
  smol?: boolean;
}

export class WorkerPool implements Disposable {
  private workers: Worker[] = [];
  private busy: Set<number> = new Set();
  private deadWorkers: Set<number> = new Set();
  private queue: PendingTask[] = [];
  private pending: Map<TaskId, PendingTask> = new Map();
  private nextId: TaskId = 0;
  private workerCode: string;
  private _blobUrl: string = "";

  constructor(options?: WorkerPoolOptions) {
    const size = options?.size ?? globalThis.navigator?.hardwareConcurrency ?? 4;
    const smol = options?.smol ?? true;

    // Inline worker code — handles generic decode tasks
    this.workerCode = `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        const { id, type, data } = event.data;
        try {
          let result: unknown;
          let transfer: ArrayBuffer[] = [];

          switch (type) {
            case "decompress": {
              // data: { compressed: ArrayBuffer, codec: string }
              // For now, pass-through — real decompression hooks TBD
              result = data.compressed;
              if (result instanceof ArrayBuffer) transfer = [result];
              break;
            }
            case "decode-strings": {
              // data: { buffer: ArrayBuffer, count: number }
              // Decode VLenUTF8 from raw buffer
              const decoder = new TextDecoder();
              const view = new DataView(data.buffer);
              const strings: string[] = [];
              let offset = 0;
              for (let i = 0; i < data.count; i++) {
                const len = view.getUint32(offset, true);
                offset += 4;
                const bytes = new Uint8Array(data.buffer, offset, len);
                strings.push(decoder.decode(bytes));
                offset += len;
              }
              result = strings;
              break;
            }
            case "noop": {
              result = data;
              break;
            }
            default:
              throw new Error("Unknown task type: " + type);
          }

          self.postMessage({ id, result, transfer }, { transfer } as any);
        } catch (e: any) {
          self.postMessage({ id, error: e.message ?? String(e) });
        }
      };
    `;

    // Create workers from blob URL — keep URL alive until workers are loaded
    const blob = new Blob([this.workerCode], { type: "application/typescript" });
    this._blobUrl = URL.createObjectURL(blob);

    for (let i = 0; i < size; i++) {
      const worker = new Worker(this._blobUrl, { smol } as any);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        this.onWorkerMessage(i, event.data);
      };
      worker.onerror = (event) => {
        console.error(`Worker ${i} error:`, event);
        // Mark worker as dead and reject all pending tasks to prevent hangs
        this.busy.delete(i);
        this.deadWorkers.add(i);
        const err = new Error(`Worker ${i} crashed: ${event.message ?? "unknown error"}`);
        for (const task of this.pending.values()) {
          task.reject(err);
        }
        this.pending.clear();
        for (const task of this.queue) {
          task.reject(err);
        }
        this.queue = [];
      };
      this.workers.push(worker);
    }
  }

  /** Submit a task to the pool. Returns a promise for the result. */
  submit<T = unknown>(type: string, data: unknown, transfer?: Transferable[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: PendingTask<T> = {
        id: this.nextId++,
        data: { type, data },
        transfer,
        resolve: resolve as any,
        reject,
      };
      this.queue.push(task as PendingTask);
      this.dispatch();
    });
  }

  /** Submit multiple tasks and return all results. Optional progress callback. */
  async submitBatch<T = unknown>(
    tasks: Array<{ type: string; data: unknown; transfer?: Transferable[] }>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<T[]> {
    let completed = 0;
    const total = tasks.length;
    const promises = tasks.map((t) =>
      this.submit<T>(t.type, t.data, t.transfer).then((result) => {
        completed++;
        onProgress?.(completed, total);
        return result;
      }),
    );
    return Promise.all(promises);
  }

  /** Number of idle workers. */
  get idle(): number {
    return this.workers.length - this.busy.size;
  }

  /** Number of queued tasks. */
  get queued(): number {
    return this.queue.length;
  }

  /** Terminate all workers. */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = "";
    }
    this.busy.clear();
    this.deadWorkers.clear();
    // Reject any pending tasks
    for (const task of this.pending.values()) {
      task.reject(new Error("Worker pool terminated"));
    }
    this.pending.clear();
    for (const task of this.queue) {
      task.reject(new Error("Worker pool terminated"));
    }
    this.queue = [];
  }

  /** Disposable — use with `using pool = new WorkerPool()` */
  [Symbol.dispose](): void {
    this.terminate();
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const workerIdx = this.findIdleWorker();
      if (workerIdx === -1) break; // all busy

      const task = this.queue.shift()!;
      this.busy.add(workerIdx);
      this.pending.set(task.id, task);

      const msg = { id: task.id, ...(task.data as any) };
      if (task.transfer?.length) {
        this.workers[workerIdx].postMessage(msg, task.transfer);
      } else {
        this.workers[workerIdx].postMessage(msg);
      }
    }
  }

  private onWorkerMessage(workerIdx: number, msg: WorkerMessage): void {
    this.busy.delete(workerIdx);

    const task = this.pending.get(msg.id);
    if (task) {
      this.pending.delete(msg.id);
      if (msg.error) {
        task.reject(new Error(msg.error));
      } else {
        task.resolve(msg.result);
      }
    }

    // Dispatch next queued task
    this.dispatch();
  }

  private findIdleWorker(): number {
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.busy.has(i) && !this.deadWorkers.has(i)) return i;
    }
    return -1;
  }
}
