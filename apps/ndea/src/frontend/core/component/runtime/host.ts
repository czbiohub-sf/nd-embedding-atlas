import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import {
  AnnotationColumnsResponseSchema,
  AnnotationPredicateWriteResponseSchema,
  CommitAnnotationsResponseSchema,
  ErrorResponseSchema,
  ObservationSetSchema,
  type FilterClause,
  type Metadata,
} from "@ndea/protocol";
import type {
  ColorCoordinationAPI,
  ComponentHost,
  FilterCoordinationAPI,
  FocusCoordinationAPI,
  NotificationAPI,
  OrderingCoordinationAPI,
  PanZoomView,
  RowIndex,
  TurntableView,
  ViewCoordinationAPI,
  ViewSyncState,
} from "@ndea/sdk";
import type { DeviceBroker, DeviceLease } from "@/core/gpu/device-broker";

export interface ComponentHostDependencies {
  readonly coordinator: Coordinator;
  readonly table: string;
  readonly metadata: Metadata;
  readonly refreshMetadata: () => Promise<void>;
  readonly deviceBroker: Pick<DeviceBroker, "acquire" | "releaseFor">;
  readonly fetch: typeof globalThis.fetch;
  readonly notify?: NotificationAPI["notify"];
}

export interface HostInit<Config> {
  readonly elementId: string;
  readonly type: string;
  readonly config: Config;
  readonly predicate: Selection;
  readonly focus: FocusCoordinationAPI;
  readonly viewSync: ViewCoordinationAPI;
  readonly ordering: OrderingCoordinationAPI;
  readonly colorBy: ColorCoordinationAPI;
  readonly filter: FilterCoordinationAPI;
  readonly patchConfig?: (patch: Partial<Config>) => void;
  /** Persists a named workspace data source (see `RowSetPublishAPI.saveSource`). */
  readonly saveSource?: (baseName: string, where: FilterClause) => string;
}

export interface HostHandle<Config> {
  readonly host: ComponentHost<Config>;
  dispose(): void;
}

function defaultNotify(message: string, level: "info" | "warn" | "error" = "info"): void {
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.info(message);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const parsed = ErrorResponseSchema.safeParse(await response.json().catch(() => null));
  return new Error(parsed.success ? parsed.data.error : fallback);
}

function createTrackedDisposer(disposers: (() => void)[], disposer: () => void): () => void {
  let active = true;
  const once = () => {
    if (!active) return;
    active = false;
    disposer();
  };
  disposers.push(once);
  return once;
}

function throwDisposalErrors(message: string, errors: unknown[]): void {
  if (errors.length === 1) throw toError(errors[0]);
  if (errors.length > 1) throw new AggregateError(errors, message);
}

/**
 * Builds one element's host from immutable app dependencies. React chooses the
 * dependency values once at composition time; each element owns only its
 * mutable config and resources.
 */
export function createComponentHost<Config>(
  dependencies: Readonly<ComponentHostDependencies>,
  init: HostInit<Config>,
): HostHandle<Config> {
  const { elementId, focus, viewSync, ordering, colorBy, filter } = init;
  const controller = new AbortController();
  const disposers: (() => void)[] = [];
  let config = init.config;
  let deviceLease: DeviceLease | null = null;
  let deviceLeasePromise: Promise<DeviceLease> | null = null;
  let disposed = false;
  const request = (
    input: Parameters<typeof globalThis.fetch>[0],
    requestInit?: Parameters<typeof globalThis.fetch>[1],
  ) => dependencies.fetch.call(globalThis, input, requestInit);
  const trackDisposer = (disposer: () => void): (() => void) => {
    const once = createTrackedDisposer(disposers, disposer);
    if (disposed) once();
    return once;
  };
  const assertActive = () => {
    if (disposed) throw new Error(`component host ${elementId} is disposed`);
  };

  const host: ComponentHost<Config> = {
    elementId,
    type: init.type,
    get config() {
      return config;
    },
    notifications: Object.freeze({ notify: dependencies.notify ?? defaultNotify }),
    signal: controller.signal,
    onDispose(disposer: () => void) {
      trackDisposer(disposer);
    },
    track(unsubscribe: () => void) {
      trackDisposer(unsubscribe);
    },
    patchConfig(patch: Partial<Config>) {
      assertActive();
      if (!init.patchConfig) throw new Error(`component host ${elementId} does not accept configuration patches`);
      const next = { ...config, ...patch };
      init.patchConfig(patch);
      config = next;
    },
    data: Object.freeze({
      coordinator: dependencies.coordinator,
      table: dependencies.table,
      metadata: dependencies.metadata,
    }),
    registerClient(client: MosaicClient) {
      assertActive();
      dependencies.coordinator.connect(client);
      return trackDisposer(() => dependencies.coordinator.disconnect(client));
    },
    predicate: init.predicate,
    dataAPI: {
      query(sql: string): Promise<unknown> {
        assertActive();
        return dependencies.coordinator.query(sql);
      },
      async createObservationSet(bits: Uint32Array<ArrayBuffer>, rows: number) {
        assertActive();
        const response = await request(`/api/sets?rows=${rows}`, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(bits.buffer, bits.byteOffset, Math.ceil(rows / 8)),
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, `set creation failed (${response.status})`);
        return ObservationSetSchema.parse(await response.json());
      },
      saveSource(baseName: string, where: FilterClause) {
        assertActive();
        if (!init.saveSource) throw new Error(`component host ${elementId} cannot save data sources`);
        return init.saveSource(baseName, where);
      },
      async listAnnotationColumns() {
        assertActive();
        const response = await request("/api/annotations/columns", { signal: controller.signal });
        if (!response.ok) throw await responseError(response, `list failed (${response.status})`);
        return AnnotationColumnsResponseSchema.parse(await response.json()).columns;
      },
      async createAnnotationColumn(
        name: string,
        dtype: "categorical" | "string" | "integer" | "float" = "categorical",
      ) {
        assertActive();
        const response = await request("/api/annotations/columns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, dtype }),
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, `create failed (${response.status})`);
        await dependencies.refreshMetadata();
      },
      async writeAnnotationByPredicate(column: string, label: string, predicate: string) {
        assertActive();
        const response = await request("/api/annotations/values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ column, label, predicate }),
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, `write failed (${response.status})`);
        const result = AnnotationPredicateWriteResponseSchema.parse(await response.json());
        await dependencies.refreshMetadata();
        return result;
      },
      async commitAnnotations(options: { dryRun: boolean; columns?: string[] }) {
        assertActive();
        const response = await request(`/api/annotations/commit${options.dryRun ? "?dryRun=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.columns ? { columns: options.columns } : {}),
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, `commit failed (${response.status})`);
        return CommitAnnotationsResponseSchema.parse(await response.json());
      },
    },
    filter: Object.freeze({
      selection: filter.selection,
      getResolved: filter.getResolved.bind(filter),
      subscribeResolved: (callback: Parameters<FilterCoordinationAPI["subscribeResolved"]>[0]) =>
        trackDisposer(filter.subscribeResolved(callback)),
      publish: filter.publish.bind(filter),
      clear: filter.clear.bind(filter),
      materializeRowIds: filter.materializeRowIds.bind(filter),
    } satisfies FilterCoordinationAPI),
    colorBy: Object.freeze({
      get linked() {
        return colorBy.linked;
      },
      get: colorBy.get,
      set(column: string | null) {
        assertActive();
        colorBy.set(column);
      },
      subscribe: (callback: (column: string | null) => void) => trackDisposer(colorBy.subscribe(callback)),
    } satisfies ColorCoordinationAPI),
    focus: Object.freeze({
      get: focus.get,
      set(rowIndex: RowIndex | null) {
        assertActive();
        focus.set(rowIndex);
      },
      ...(focus.subscribe
        ? { subscribe: (callback: (rowIndex: RowIndex | null) => void) => trackDisposer(focus.subscribe!(callback)) }
        : {}),
    }),
    viewSync: Object.freeze({
      get panX() {
        return viewSync.panX;
      },
      get panY() {
        return viewSync.panY;
      },
      get zoom() {
        return viewSync.zoom;
      },
      get linked() {
        return viewSync.linked;
      },
      broadcast(state: PanZoomView | TurntableView) {
        assertActive();
        viewSync.broadcast(state);
      },
      toggleLock() {
        assertActive();
        viewSync.toggleLock();
      },
      ...(viewSync.subscribe
        ? {
            subscribe: (callback: (state: ViewSyncState) => void) => trackDisposer(viewSync.subscribe!(callback)),
          }
        : {}),
    }),
    ordering: Object.freeze({
      get: ordering.get,
      set(value: { col: string; dir: "asc" | "desc" } | null) {
        assertActive();
        ordering.set(value);
      },
      ...(ordering.subscribe
        ? {
            subscribe: (callback: (value: { col: string; dir: "asc" | "desc" } | null) => void) =>
              trackDisposer(ordering.subscribe!(callback)),
          }
        : {}),
    }),
    acquireDeviceLease() {
      assertActive();
      deviceLeasePromise ??= dependencies.deviceBroker.acquire(elementId, controller.signal).then((lease) => {
        if (disposed) {
          lease.release();
          throw new DOMException("device acquire aborted", "AbortError");
        }
        deviceLease = lease;
        return lease;
      });
      return deviceLeasePromise;
    },
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const errors: unknown[] = [];
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      if (deviceLease) deviceLease.release();
      else dependencies.deviceBroker.releaseFor(elementId);
    } catch (error) {
      errors.push(error);
    }
    throwDisposalErrors(`component host ${elementId} disposal failed`, errors);
  }

  return { host, dispose };
}
