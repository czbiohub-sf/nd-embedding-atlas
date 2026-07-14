import type { Coordinator, MosaicClient, Selection } from "@uwdata/mosaic-core";
import {
  AnnotationColumnsResponseSchema,
  AnnotationPredicateWriteResponseSchema,
  CommitAnnotationsResponseSchema,
  ErrorResponseSchema,
  SelectionPublishResponseSchema,
  type Metadata,
} from "@ndea/protocol";
import type {
  FocusCoordinationAPI,
  NodeCapability,
  NodeDataAPI,
  NodeDefinition,
  NodeInstanceId,
  NodeNotificationAPI,
  OrderingCoordinationAPI,
  RowIndex,
  RowSetPublication,
  ViewCoordinationAPI,
} from "@ndea/sdk";
import type { PredicateBus, PredicateFacet, RowSetBus } from "@/core/buses";
import type { DeviceBroker, DeviceLease } from "@/core/gpu/device-broker";
import type { AppNodeHost } from "@/core/node/app-node-host";

export interface AppNodeHostDependencies {
  readonly coordinator: Coordinator;
  readonly defaultInputPredicate: Selection;
  readonly table: string;
  readonly metadata: Metadata;
  readonly refreshMetadata: () => Promise<void>;
  readonly availableCapabilities: ReadonlySet<NodeCapability>;
  readonly predicateBus: Pick<PredicateBus, "publishPredicate" | "makeToken" | "disposeInstance">;
  readonly rowSetBus: Pick<RowSetBus, "publishRowSet" | "clear" | "disposeFor">;
  readonly deviceBroker: Pick<DeviceBroker, "acquire" | "releaseFor">;
  readonly fetch: typeof globalThis.fetch;
  readonly notify?: NodeNotificationAPI["notify"];
}

export interface HostRowSetInput {
  externalRowSet(): readonly RowIndex[] | null;
  onExternalRowSet(callback: (rowIndices: readonly RowIndex[] | null) => void): () => void;
}

export interface HostInit<Config, Facets extends object = object> {
  readonly instanceId: NodeInstanceId;
  readonly definition: Pick<NodeDefinition, "ref" | "capabilities">;
  readonly config: Config;
  readonly bodyHeaderElement?: HTMLElement;
  readonly inputPredicate?: Selection;
  readonly rowSetInput?: HostRowSetInput;
  readonly focus?: FocusCoordinationAPI;
  readonly viewCoordination?: ViewCoordinationAPI;
  readonly ordering?: OrderingCoordinationAPI;
  readonly facets?: Facets;
  readonly patchConfig?: (patch: Partial<Config>) => void;
  readonly publishPredicate?: (facet: string, sql: string | null) => void;
  readonly onDataRowSetPublished?: (publication: RowSetPublication, rowIds: readonly RowIndex[]) => void;
}

export interface HostHandle<Config, Facets extends object = object> {
  readonly host: AppNodeHost<Config, NodeCapability, Facets>;
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
 * Builds one capability-gated host from immutable app dependencies. This is a
 * plain factory: React chooses the dependency values once at composition time,
 * while each instance owns only its mutable config and resources.
 */
export function createAppNodeHost<Config, Facets extends object = object>(
  dependencies: Readonly<AppNodeHostDependencies>,
  init: HostInit<Config, Facets>,
): HostHandle<Config, Facets> {
  const { definition, instanceId } = init;
  const requested = new Set<NodeCapability>(definition.capabilities);
  const granted = new Set<NodeCapability>();
  const controller = new AbortController();
  const disposers: (() => void)[] = [];
  let config = init.config;
  let deviceLease: DeviceLease | null = null;
  let deviceLeasePromise: Promise<DeviceLease> | null = null;
  let publishedRowSetDisposed = true;
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
    if (disposed) throw new Error(`node host ${instanceId} is disposed`);
  };

  const host: Record<PropertyKey, unknown> = {
    instanceId,
    definitionRef: definition.ref,
    capabilities: granted,
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
      if (!init.patchConfig) throw new Error(`node host ${instanceId} does not accept configuration patches`);
      const next = { ...config, ...patch };
      init.patchConfig(patch);
      config = next;
    },
  };
  Object.defineProperty(host, "config", { enumerable: true, get: () => config });

  if (init.bodyHeaderElement) host.bodyHeaderElement = init.bodyHeaderElement;

  if (requested.has("data-read") && dependencies.availableCapabilities.has("data-read")) {
    granted.add("data-read");
    host.data = Object.freeze({
      coordinator: dependencies.coordinator,
      table: dependencies.table,
      metadata: dependencies.metadata,
    });
    host.registerClient = (client: MosaicClient) => {
      assertActive();
      dependencies.coordinator.connect(client);
      return trackDisposer(() => dependencies.coordinator.disconnect(client));
    };
    host.inputPredicate = init.inputPredicate ?? dependencies.defaultInputPredicate;
  }

  const canPublishRows = requested.has("row-set-publish") && dependencies.availableCapabilities.has("row-set-publish");
  const canWriteAnnotations =
    requested.has("annotation-write") && dependencies.availableCapabilities.has("annotation-write");

  if (granted.has("data-read")) {
    const dataAPI = {
      query<T = unknown>(sql: string) {
        assertActive();
        return dependencies.coordinator.query(sql) as unknown as Promise<T>;
      },
      ...(canPublishRows
        ? {
            async publishRowSet(rowIds: RowIndex[]) {
              assertActive();
              const response = await request(`/api/selection/${encodeURIComponent(instanceId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ row_indices: rowIds }),
                signal: controller.signal,
              });
              if (!response.ok) throw await responseError(response, `selection failed (${response.status})`);
              const parsed = SelectionPublishResponseSchema.parse(await response.json());
              const publication = dependencies.predicateBus.makeToken(parsed.table, parsed.count);
              publishedRowSetDisposed = false;
              init.onDataRowSetPublished?.(publication, rowIds);
              return publication;
            },
            disposePublishedRowSet() {
              if (publishedRowSetDisposed) return;
              publishedRowSetDisposed = true;
              void request(`/api/selection/${encodeURIComponent(instanceId)}`, { method: "DELETE" }).catch(
                (error: unknown) =>
                  (dependencies.notify ?? defaultNotify)(
                    `failed to dispose published row set for ${instanceId}: ${toError(error).message}`,
                    "error",
                  ),
              );
            },
          }
        : {}),
      ...(canWriteAnnotations
        ? {
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
          }
        : {}),
    } as NodeDataAPI;
    host.dataAPI = dataAPI;
  }

  if (canWriteAnnotations && granted.has("data-read")) granted.add("annotation-write");

  if (
    requested.has("row-set-subscribe") &&
    dependencies.availableCapabilities.has("row-set-subscribe") &&
    init.rowSetInput
  ) {
    granted.add("row-set-subscribe");
    host.externalRowSet = init.rowSetInput.externalRowSet;
    host.onExternalRowSet = (callback: (rowIndices: readonly RowIndex[] | null) => void) =>
      trackDisposer(init.rowSetInput!.onExternalRowSet(callback));
  }

  if (requested.has("predicate-publish") && dependencies.availableCapabilities.has("predicate-publish")) {
    granted.add("predicate-publish");
    host.publishPredicate = (facet: string, sql: string | null) => {
      assertActive();
      if (init.publishPredicate) init.publishPredicate(facet, sql);
      else dependencies.predicateBus.publishPredicate(instanceId, facet as PredicateFacet, sql);
    };
  }

  if (canPublishRows && granted.has("data-read")) {
    granted.add("row-set-publish");
    host.publishRowSet = (rowIndices: RowIndex[]) => {
      assertActive();
      dependencies.rowSetBus.publishRowSet(instanceId, rowIndices);
    };
    host.clearRowSet = () => {
      assertActive();
      dependencies.rowSetBus.clear(instanceId);
    };
  }

  if (
    requested.has("focus-coordination") &&
    dependencies.availableCapabilities.has("focus-coordination") &&
    init.focus
  ) {
    granted.add("focus-coordination");
    host.focus = Object.freeze({
      get: init.focus.get,
      set(rowIndex: RowIndex | null) {
        assertActive();
        init.focus!.set(rowIndex);
      },
      ...(init.focus.subscribe
        ? {
            subscribe: (callback: (rowIndex: RowIndex | null) => void) =>
              trackDisposer(init.focus!.subscribe!(callback)),
          }
        : {}),
    });
  }

  if (
    requested.has("view-coordination") &&
    dependencies.availableCapabilities.has("view-coordination") &&
    init.viewCoordination
  ) {
    granted.add("view-coordination");
    const source = init.viewCoordination;
    host.viewCoordination = Object.freeze({
      get panX() {
        return source.panX;
      },
      get panY() {
        return source.panY;
      },
      get zoom() {
        return source.zoom;
      },
      get linked() {
        return source.linked;
      },
      broadcast(state: { panX: number; panY: number; zoom: number }) {
        assertActive();
        source.broadcast(state);
      },
      toggleLock() {
        assertActive();
        source.toggleLock();
      },
      ...(source.subscribe
        ? {
            subscribe: (callback: (state: { panX: number; panY: number; zoom: number }) => void) =>
              trackDisposer(source.subscribe!(callback)),
          }
        : {}),
    });
  }

  if (
    requested.has("ordering-coordination") &&
    dependencies.availableCapabilities.has("ordering-coordination") &&
    init.ordering
  ) {
    granted.add("ordering-coordination");
    host.ordering = Object.freeze({
      get: init.ordering.get,
      set(value: { col: string; dir: "asc" | "desc" } | null) {
        assertActive();
        init.ordering!.set(value);
      },
      ...(init.ordering.subscribe
        ? {
            subscribe: (callback: (value: { col: string; dir: "asc" | "desc" } | null) => void) =>
              trackDisposer(init.ordering!.subscribe!(callback)),
          }
        : {}),
    });
  }

  if (requested.has("gpu-device") && dependencies.availableCapabilities.has("gpu-device")) {
    granted.add("gpu-device");
    host.acquireDeviceLease = () => {
      assertActive();
      deviceLeasePromise ??= dependencies.deviceBroker.acquire(instanceId, controller.signal).then((lease) => {
        if (disposed) {
          lease.release();
          throw new DOMException("device acquire aborted", "AbortError");
        }
        deviceLease = lease;
        return lease;
      });
      return deviceLeasePromise;
    };
  }

  for (const capability of requested) {
    if (
      dependencies.availableCapabilities.has(capability) &&
      (capability === "schema-mutation" ||
        capability === "spatial-data" ||
        capability === "collection-read" ||
        capability === "wasm-bitmap" ||
        capability === "compute")
    ) {
      granted.add(capability);
    }
  }

  Object.assign(host, init.facets);

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
      else dependencies.deviceBroker.releaseFor(instanceId);
    } catch (error) {
      errors.push(error);
    }
    if (granted.has("row-set-publish")) {
      try {
        dependencies.rowSetBus.disposeFor(instanceId);
        (host.dataAPI as NodeDataAPI).disposePublishedRowSet?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (granted.has("predicate-publish")) {
      try {
        dependencies.predicateBus.disposeInstance(instanceId);
      } catch (error) {
        errors.push(error);
      }
    }
    throwDisposalErrors(`node host ${instanceId} disposal failed`, errors);
  }

  return { host: host as AppNodeHost<Config, NodeCapability, Facets>, dispose };
}
