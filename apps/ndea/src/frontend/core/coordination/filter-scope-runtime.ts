import { Selection, type MosaicClient } from "@uwdata/mosaic-core";
import type {
  FilterCoordinationAPI,
  FilterFacet,
  MaterializedFilterRows,
  NodeInstanceId,
  ResolvedFilter,
  RowIndex,
} from "@ndea/sdk";

import { stringPredicate, toRows } from "@/lib/mosaic-helpers";

interface PublishedFacet {
  readonly predicate: string;
  readonly rowIds?: readonly RowIndex[];
}

interface ScopeState {
  readonly members: Set<FilterScopeBinding>;
}

function composePredicates(predicates: readonly string[]): string | null {
  if (predicates.length === 0) return null;
  if (predicates.length === 1) return predicates[0];
  return predicates.map((predicate) => `(${predicate})`).join(" AND ");
}

function composeFacets(facets: ReadonlyMap<FilterFacet, PublishedFacet>): string | null {
  return composePredicates([...facets.values()].map((facet) => facet.predicate));
}

function composeMaterializedFacets(facets: ReadonlyMap<FilterFacet, PublishedFacet>): string | null {
  return composePredicates(
    [...facets.values()].map((facet) =>
      facet.rowIds
        ? facet.rowIds.length > 0
          ? `__row_index__ IN (${facet.rowIds.join(", ")})`
          : "FALSE"
        : facet.predicate,
    ),
  );
}

function abortError(): DOMException {
  return new DOMException("filter materialization aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  const result = Promise.withResolvers<T>();
  const abort = () => result.reject(abortError());
  signal.addEventListener("abort", abort, { once: true });
  promise.then(
    (value) => {
      signal.removeEventListener("abort", abort);
      result.resolve(value);
    },
    (error: unknown) => {
      signal.removeEventListener("abort", abort);
      result.reject(error);
    },
  );
  return result.promise;
}

interface FilterScopeBindingAPI extends FilterCoordinationAPI {
  setScope(scope?: string): void;
  setGraphPredicate(predicate: string | null): void;
  dispose(): void;
}

interface FilterScopeRegistryOptions {
  readonly coordinator: { query(sql: string): Promise<unknown> };
  readonly table: string;
}

export class FilterScopeRegistry {
  private readonly coordinator: FilterScopeRegistryOptions["coordinator"];
  private readonly table: string;
  private readonly scopes = new Map<string, ScopeState>();
  private readonly bindings = new Map<NodeInstanceId, FilterScopeBinding>();
  private disposed = false;

  constructor(options: FilterScopeRegistryOptions) {
    this.coordinator = options.coordinator;
    this.table = options.table;
  }

  get bindingCount(): number {
    return this.bindings.size;
  }

  get scopeCount(): number {
    return this.scopes.size;
  }

  bind(instanceId: NodeInstanceId): FilterScopeBindingAPI {
    if (this.disposed) throw new Error("filter scope registry is disposed");
    if (this.bindings.has(instanceId)) throw new Error(`filter binding already exists: ${instanceId}`);
    const binding = new FilterScopeBinding(this, instanceId);
    this.bindings.set(instanceId, binding);
    return binding;
  }

  move(binding: FilterScopeBinding, scope?: string): void {
    if (binding.scope === scope) return;
    const previous = binding.scope;
    if (previous !== undefined) {
      const state = this.scopes.get(previous)!;
      state.members.delete(binding);
      for (const member of state.members) this.mirror(member, binding, null);
      for (const publisher of state.members) this.mirror(binding, publisher, null);
      this.mirror(binding, binding, null);
      if (state.members.size === 0) this.scopes.delete(previous);
    }

    binding.scope = scope;
    if (scope === undefined) {
      binding.changed();
      return;
    }

    let state = this.scopes.get(scope);
    if (!state) {
      state = { members: new Set<FilterScopeBinding>() };
      this.scopes.set(scope, state);
    }
    const peers = [...state.members];
    state.members.add(binding);
    for (const publisher of state.members) this.mirror(binding, publisher, publisher.predicate());
    const predicate = binding.predicate();
    if (predicate !== null) {
      const materializedPredicate = binding.materializedPredicate();
      for (const peer of peers) this.mirror(peer, binding, predicate, materializedPredicate);
    }
  }

  publicationChanged(binding: FilterScopeBinding): void {
    if (binding.scope === undefined) {
      binding.changed();
      return;
    }
    const predicate = binding.predicate();
    const materializedPredicate = predicate === null ? null : binding.materializedPredicate();
    for (const member of this.scopes.get(binding.scope)!.members) {
      this.mirror(member, binding, predicate, materializedPredicate);
    }
  }

  remove(binding: FilterScopeBinding): void {
    if (this.bindings.get(binding.instanceId) !== binding) return;
    this.move(binding);
    this.bindings.delete(binding.instanceId);
  }

  async materialize(binding: FilterScopeBinding, signal?: AbortSignal): Promise<MaterializedFilterRows> {
    const revision = binding.revision;
    const predicate = binding.materializationPredicate();
    const sql = `SELECT __row_index__ FROM ${this.table}${predicate ? ` WHERE ${predicate}` : ""}`;
    const result = await abortable(this.coordinator.query(sql), signal);
    if (signal?.aborted) throw abortError();
    if (!binding.live || binding.revision !== revision) {
      throw new Error("filter changed during row-id materialization");
    }
    const rowIds = toRows(result).map((row) => Number(row.__row_index__) as RowIndex);
    return { rowIds, revision };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const binding of this.bindings.values()) binding.dispose();
    this.bindings.clear();
    this.scopes.clear();
  }

  private mirror(
    target: FilterScopeBinding,
    publisher: FilterScopeBinding,
    predicate: string | null,
    materializedPredicate = predicate === null ? null : publisher.materializedPredicate(),
  ): void {
    if (predicate === null) {
      target.mirrored.delete(publisher.source);
      target.materializedMirrored.delete(publisher.source);
    } else {
      target.mirrored.set(publisher.source, predicate);
      target.materializedMirrored.set(publisher.source, materializedPredicate!);
    }
    target.selection.update({
      source: publisher.source,
      clients: publisher.clients,
      fields: [],
      value: predicate,
      predicate: predicate ? stringPredicate(predicate) : null,
    });
    target.changed();
  }
}

class FilterScopeBinding implements FilterScopeBindingAPI {
  readonly selection = Selection.crossfilter();
  readonly source: { readonly __ndeaFilterSource: NodeInstanceId };
  readonly clients = new Set<MosaicClient>();
  readonly facets = new Map<FilterFacet, PublishedFacet>();
  readonly mirrored = new Map<object, string>();
  readonly materializedMirrored = new Map<object, string>();
  scope: string | undefined;
  revision = 0;

  private readonly graphSource: { readonly __ndeaGraphPredicate: NodeInstanceId };
  private readonly listeners = new Set<(filter: ResolvedFilter) => void>();
  private graphPredicate: string | null = null;
  private graphPredicateInitialized = false;
  private disposed = false;
  private readonly registry: FilterScopeRegistry;
  readonly instanceId: NodeInstanceId;

  get live(): boolean {
    return !this.disposed;
  }

  constructor(registry: FilterScopeRegistry, instanceId: NodeInstanceId) {
    this.registry = registry;
    this.instanceId = instanceId;
    this.source = { __ndeaFilterSource: instanceId };
    this.graphSource = { __ndeaGraphPredicate: instanceId };
  }

  getResolved(): ResolvedFilter {
    return { predicate: this.resolvedPredicate(), revision: this.revision };
  }

  subscribeResolved(callback: (filter: ResolvedFilter) => void): () => void {
    this.assertLive();
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  publish(facet: FilterFacet, predicate: string, rowIds?: readonly RowIndex[]): void {
    this.assertLive();
    this.facets.set(facet, { predicate, ...(rowIds ? { rowIds: [...rowIds] } : {}) });
    this.registry.publicationChanged(this);
  }

  clear(facet: FilterFacet): void {
    this.assertLive();
    this.facets.delete(facet);
    this.registry.publicationChanged(this);
  }

  associateClient(client: MosaicClient): void {
    this.assertLive();
    this.clients.add(client);
  }

  disassociateClient(client: MosaicClient): void {
    this.clients.delete(client);
  }

  materializeRowIds(signal?: AbortSignal): Promise<MaterializedFilterRows> {
    this.assertLive();
    return this.registry.materialize(this, signal);
  }

  setScope(scope?: string): void {
    this.assertLive();
    this.registry.move(this, scope);
  }

  setGraphPredicate(predicate: string | null): void {
    this.assertLive();
    if (this.graphPredicateInitialized && this.graphPredicate === predicate) return;
    this.graphPredicateInitialized = true;
    this.graphPredicate = predicate;
    this.selection.update({
      source: this.graphSource,
      clients: new Set(),
      fields: [],
      value: predicate,
      predicate: predicate ? stringPredicate(predicate) : null,
    });
    this.changed();
  }

  dispose(): void {
    if (this.disposed) return;
    this.registry.remove(this);
    this.disposed = true;
    this.selection.update({ source: this.graphSource, clients: new Set(), fields: [], value: null, predicate: null });
    this.clients.clear();
    this.facets.clear();
    this.listeners.clear();
    this.mirrored.clear();
    this.materializedMirrored.clear();
  }

  predicate(): string | null {
    return composeFacets(this.facets);
  }

  materializedPredicate(): string {
    return composeMaterializedFacets(this.facets)!;
  }

  resolvedPredicate(): string | null {
    return composePredicates(
      [this.graphPredicate, ...this.mirrored.values()].filter((predicate): predicate is string => predicate !== null),
    );
  }

  materializationPredicate(): string | null {
    return composePredicates(
      [this.graphPredicate, ...this.materializedMirrored.values()].filter(
        (predicate): predicate is string => predicate !== null,
      ),
    );
  }

  changed(): void {
    this.revision += 1;
    const filter = this.getResolved();
    for (const listener of this.listeners) listener(filter);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error(`filter binding ${this.instanceId} is disposed`);
  }
}
