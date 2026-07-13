import { DataCapabilitySchema } from "@ndea/protocol";
import {
  PluginManifestSchema,
  SDK_VERSION,
  compareSemanticVersions,
  isSemanticVersion,
  isVersionCompatible,
  type ExactNodeTypeRef,
  type NodeCapability,
  type NodeRole,
  type NodeTypeId,
  type PluginFactory,
} from "@ndea/sdk";
import {
  collectPluginContribution,
  disposePluginContributions,
  formatContributionSource,
  freezeContributionSource,
  type CatalogNodeDefinition,
  type NodeContributionSource,
  type PluginContributionBatch,
} from "./registration";

const NODE_TYPE_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const PORT_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NODE_CAPABILITIES: Record<NodeCapability, true> = {
  "data-read": true,
  "predicate-publish": true,
  "row-set-publish": true,
  "row-set-subscribe": true,
  "focus-coordination": true,
  "view-coordination": true,
  "schema-mutation": true,
  "spatial-data": true,
  "collection-read": true,
  "gpu-device": true,
  "wasm-bitmap": true,
  compute: true,
  "annotation-write": true,
  "ordering-coordination": true,
};

const DEFINITION_FIELDS: Record<string, true> = {
  ref: true,
  title: true,
  role: true,
  inputs: true,
  outputs: true,
  capabilities: true,
  dataRequirements: true,
  config: true,
  availability: true,
  evaluate: true,
  load: true,
  documentation: true,
  presentation: true,
};
const EMPTY_DEFINITIONS: readonly CatalogNodeDefinition[] = Object.freeze([]);

export interface NodeCatalogEntry {
  readonly definition: CatalogNodeDefinition;
  readonly source: NodeContributionSource;
}

export interface NodeCatalog {
  readonly size: number;
  resolveExact(ref: ExactNodeTypeRef): CatalogNodeDefinition | undefined;
  resolveCurrent(nodeTypeId: NodeTypeId | string): CatalogNodeDefinition | undefined;
  entryExact(ref: ExactNodeTypeRef): NodeCatalogEntry | undefined;
  entryCurrent(nodeTypeId: NodeTypeId | string): NodeCatalogEntry | undefined;
  listDefinitions(): readonly CatalogNodeDefinition[];
  listByRole(role: NodeRole): readonly CatalogNodeDefinition[];
}

export class NodeCatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeCatalogValidationError";
  }
}

/** Mutable only while startup is collecting isolated batches. `freeze` is the cutover. */
export class NodeCatalogBuilder {
  readonly #entries: NodeCatalogEntry[] = [];
  readonly #exact = new Map<string, NodeCatalogEntry>();
  #catalog: NodeCatalog | undefined;

  commit(batch: PluginContributionBatch): void {
    if (this.#catalog) throw new Error("node catalog is frozen");
    validateSource(batch.source);
    const source = freezeContributionSource(batch.source);

    const pending = new Map<string, NodeCatalogEntry>();
    for (const definition of batch.definitions) {
      validateDefinition(definition, source);
      const key = exactKey(definition.ref);
      const conflict = pending.get(key) ?? this.#exact.get(key);
      if (conflict) throw exactRefConflict(definition.ref, conflict.source, source);
      pending.set(key, { definition, source });
    }

    const frozenEntries: NodeCatalogEntry[] = [];
    for (const entry of pending.values()) {
      freezeDefinition(entry.definition);
      frozenEntries.push(Object.freeze(entry));
    }
    for (const frozenEntry of frozenEntries) {
      this.#entries.push(frozenEntry);
      this.#exact.set(exactKey(frozenEntry.definition.ref), frozenEntry);
    }
  }

  freeze(): NodeCatalog {
    if (this.#catalog) return this.#catalog;

    const entries = Object.freeze([...this.#entries]);
    const exact = new Map(this.#exact);
    const current = new Map<string, NodeCatalogEntry>();
    for (const entry of entries) {
      const id = entry.definition.ref.nodeTypeId;
      const existing = current.get(id);
      if (
        !existing ||
        compareSemanticVersions(existing.definition.ref.nodeTypeVersion, entry.definition.ref.nodeTypeVersion) < 0
      ) {
        current.set(id, entry);
      }
    }

    const definitions = Object.freeze(entries.map(({ definition }) => definition));
    const definitionsByRole = new Map<NodeRole, readonly CatalogNodeDefinition[]>([
      ["view", Object.freeze(definitions.filter(({ role }) => role === "view"))],
      ["transform", Object.freeze(definitions.filter(({ role }) => role === "transform"))],
    ]);

    this.#catalog = Object.freeze({
      size: entries.length,
      resolveExact: (ref: ExactNodeTypeRef) => exact.get(exactKey(ref))?.definition,
      resolveCurrent: (nodeTypeId: NodeTypeId | string) => current.get(nodeTypeId)?.definition,
      entryExact: (ref: ExactNodeTypeRef) => exact.get(exactKey(ref)),
      entryCurrent: (nodeTypeId: NodeTypeId | string) => current.get(nodeTypeId),
      listDefinitions: () => definitions,
      listByRole: (role: NodeRole) => definitionsByRole.get(role) ?? EMPTY_DEFINITIONS,
    });
    return this.#catalog;
  }
}

/**
 * Owns setup-time catalog mutation and the session disposer stack. A rejected
 * factory batch is disposed without changing previously committed batches.
 */
export class NodeCatalogRegistration {
  readonly #builder = new NodeCatalogBuilder();
  readonly #batches: PluginContributionBatch[] = [];
  #frozen = false;
  #disposed = false;

  async register(
    source: NodeContributionSource,
    factory: PluginFactory,
    validateBatch?: (batch: PluginContributionBatch) => void,
  ): Promise<void> {
    if (this.#frozen) throw new Error("node catalog registration is frozen");
    if (this.#disposed) throw new Error("node catalog registration is disposed");
    const batch = await collectPluginContribution(source, factory);
    try {
      validateBatch?.(batch);
      this.#builder.commit(batch);
    } catch (error) {
      try {
        disposePluginContributions([batch]);
      } catch (disposalError) {
        // eslint-disable-next-line preserve-caught-error -- AggregateError preserves both independent failures
        throw new AggregateError([error, disposalError], "node contribution validation and disposal failed", {
          cause: error,
        });
      }
      throw error;
    }
    this.#batches.push(batch);
  }

  freeze(): NodeCatalog {
    if (this.#disposed) throw new Error("node catalog registration is disposed");
    this.#frozen = true;
    return this.#builder.freeze();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    disposePluginContributions(this.#batches);
  }
}

export function createNodeCatalog(batches: readonly PluginContributionBatch[]): NodeCatalog {
  const builder = new NodeCatalogBuilder();
  for (const batch of batches) builder.commit(batch);
  return builder.freeze();
}

function validateSource(source: NodeContributionSource): void {
  if (source.kind === "native") {
    if (typeof source.sourceId !== "string" || !source.sourceId.trim())
      throw new NodeCatalogValidationError("native contribution source requires a sourceId");
    return;
  }

  const manifestResult = PluginManifestSchema.safeParse(source.manifest);
  if (!manifestResult.success) {
    throw new NodeCatalogValidationError(
      `invalid plugin contribution source "${formatContributionSource(source)}": ${manifestResult.error.message}`,
    );
  }
  const { manifest } = source;
  if (!isVersionCompatible(String(SDK_VERSION), manifest.sdkVersionRange)) {
    throw new NodeCatalogValidationError(
      `plugin source "${formatContributionSource(source)}" requires SDK "${manifest.sdkVersionRange}"; host SDK is "${SDK_VERSION}"`,
    );
  }
}

function validateDefinition(definition: CatalogNodeDefinition, source: NodeContributionSource): void {
  const label = formatContributionSource(source);
  if (!definition || typeof definition !== "object") fail(label, "definition must be an object");
  for (const field of Object.keys(definition)) {
    if (!DEFINITION_FIELDS[field]) fail(label, `definition contains app-only or unknown field "${field}"`);
  }

  const id = definition.ref?.nodeTypeId;
  const version = definition.ref?.nodeTypeVersion;
  if (typeof id !== "string" || !NODE_TYPE_ID_RE.test(id)) fail(label, `invalid node type ID "${String(id)}"`);
  if (typeof version !== "string" || !isSemanticVersion(version))
    fail(label, `invalid node type version "${String(version)}"`);
  validateOwnership(id, source);
  if (typeof definition.title !== "string" || !definition.title.trim()) fail(label, `node "${id}" requires a title`);
  if (definition.role !== "view" && definition.role !== "transform") fail(label, `node "${id}" has invalid role`);

  validatePorts(definition.inputs, "input", id, label);
  validatePorts(definition.outputs, "output", id, label);
  validateCapabilities(definition, label);
  validateConfig(definition, label);

  if (definition.evaluate !== undefined && typeof definition.evaluate !== "function")
    fail(label, `node "${id}" evaluate must be a function`);
  if (definition.load !== undefined && typeof definition.load !== "function")
    fail(label, `node "${id}" load must be a function`);
  if (definition.availability !== undefined && typeof definition.availability !== "function")
    fail(label, `node "${id}" availability must be a function`);
  validateDocumentation(definition, label);
  validatePresentation(definition, label);
}

function validateOwnership(id: string, source: NodeContributionSource): void {
  const label = formatContributionSource(source);
  if (source.kind === "native") {
    const namespace = id.includes("/") ? id.slice(0, id.indexOf("/")) : undefined;
    if (namespace && namespace !== "ndea")
      fail(label, `native node type ID "${id}" may only use the reserved "ndea/" namespace`);
    return;
  }

  const pluginId = source.manifest.pluginId;
  if (id.startsWith("ndea/")) fail(label, `node type ID "${id}" uses the reserved "ndea/" namespace`);
  if (!id.startsWith(`${pluginId}/`) || id.length === pluginId.length + 1)
    fail(label, `external node type ID "${id}" must be owned by "${pluginId}/"`);
}

function validatePorts(ports: CatalogNodeDefinition["inputs"], direction: string, id: string, label: string): void {
  if (!Array.isArray(ports)) fail(label, `node "${id}" ${direction}s must be an array`);
  const ids = new Set<string>();
  for (const port of ports) {
    if (!port || typeof port !== "object") fail(label, `node "${id}" has an invalid ${direction} port`);
    if (!PORT_ID_RE.test(port.id)) fail(label, `node "${id}" has invalid ${direction} port ID "${port.id}"`);
    if (ids.has(port.id)) fail(label, `node "${id}" duplicates ${direction} port "${port.id}"`);
    ids.add(port.id);
    if (port.kind !== "pred" && port.kind !== "sel" && port.kind !== "focus")
      fail(label, `node "${id}" ${direction} port "${port.id}" has invalid kind`);
    if (typeof port.label !== "string" || !port.label.trim())
      fail(label, `node "${id}" ${direction} port "${port.id}" requires a label`);
    if (port.fanIn !== undefined && port.fanIn !== "and" && port.fanIn !== "or" && port.fanIn !== "diff")
      fail(label, `node "${id}" ${direction} port "${port.id}" has invalid fan-in`);
    if (port.multiple !== undefined && typeof port.multiple !== "boolean")
      fail(label, `node "${id}" ${direction} port "${port.id}" has invalid multiple flag`);
    if (port.fanIn !== undefined && port.multiple !== true)
      fail(label, `node "${id}" ${direction} port "${port.id}" requires multiple=true for fan-in`);
    if (port.documentation !== undefined && typeof port.documentation !== "string")
      fail(label, `node "${id}" ${direction} port "${port.id}" has invalid documentation`);
  }
}

function validateCapabilities(definition: CatalogNodeDefinition, label: string): void {
  const id = definition.ref.nodeTypeId;
  if (!Array.isArray(definition.capabilities)) fail(label, `node "${id}" capabilities must be an array`);
  const seen = new Set<string>();
  for (const capability of definition.capabilities) {
    if (typeof capability !== "string" || !(capability in NODE_CAPABILITIES))
      fail(label, `node "${id}" declares unknown capability "${String(capability)}"`);
    if (seen.has(capability)) fail(label, `node "${id}" duplicates capability "${capability}"`);
    seen.add(capability);
  }

  const requirements = definition.dataRequirements ?? [];
  if (!Array.isArray(requirements)) fail(label, `node "${id}" data requirements must be an array`);
  const seenRequirements = new Set<string>();
  for (const requirement of requirements) {
    if (!DataCapabilitySchema.safeParse(requirement).success)
      fail(label, `node "${id}" declares unknown data requirement "${requirement}"`);
    if (seenRequirements.has(requirement)) fail(label, `node "${id}" duplicates data requirement "${requirement}"`);
    seenRequirements.add(requirement);
  }
  if (requirements.length > 0 && !seen.has("data-read"))
    fail(label, `node "${id}" data requirements require capability "data-read"`);
}

function validateConfig(definition: CatalogNodeDefinition, label: string): void {
  const config = definition.config;
  if (!config) return;
  const id = definition.ref.nodeTypeId;
  const version = Number(config.version);
  if (!Number.isSafeInteger(version) || version < 1)
    fail(label, `node "${id}" has invalid config version "${config.version}"`);
  if (!config.schema || typeof config.schema.safeParse !== "function")
    fail(label, `node "${id}" requires a config schema`);
  const defaultResult = config.schema.safeParse(config.defaultValue);
  if (!defaultResult.success) fail(label, `node "${id}" has an invalid default config: ${defaultResult.error.message}`);
  validateJsonValue(config.defaultValue, label, `node "${id}" default config`);
  validateJsonValue(defaultResult.data, label, `node "${id}" parsed default config`);

  const migrations = config.migrations ?? [];
  if (!Array.isArray(migrations)) fail(label, `node "${id}" config migrations must be an array`);
  const firstFrom = migrations.length > 0 ? Number(migrations[0]!.from) : version;
  if (migrations.length > 0 && (!Number.isSafeInteger(firstFrom) || firstFrom < 0 || firstFrom >= version))
    fail(label, `node "${id}" config migrations have an invalid starting version`);
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]!;
    const expectedFrom = firstFrom + index;
    if (Number(migration.from) !== expectedFrom || Number(migration.to) !== expectedFrom + 1)
      fail(label, `node "${id}" config migration ${index} must be ${expectedFrom} -> ${expectedFrom + 1}`);
    if (typeof migration.migrate !== "function") fail(label, `node "${id}" config migration ${index} requires migrate`);
  }
  if (migrations.length > 0 && Number(migrations.at(-1)!.to) !== version)
    fail(label, `node "${id}" config migrations must terminate at version ${version}`);
}

function validateDocumentation(definition: CatalogNodeDefinition, label: string): void {
  const documentation = definition.documentation;
  if (!documentation) return;
  const id = definition.ref.nodeTypeId;
  if (typeof documentation.summary !== "string" || !documentation.summary.trim())
    fail(label, `node "${id}" documentation requires a summary`);
  if (typeof documentation.use !== "string" || !documentation.use.trim())
    fail(label, `node "${id}" documentation requires usage guidance`);
  if (documentation.note !== undefined && typeof documentation.note !== "string")
    fail(label, `node "${id}" documentation note must be a string`);
}

function validatePresentation(definition: CatalogNodeDefinition, label: string): void {
  const presentation = definition.presentation;
  if (!presentation) return;
  const id = definition.ref.nodeTypeId;
  if (presentation.icon !== undefined && (typeof presentation.icon !== "string" || !presentation.icon.trim()))
    fail(label, `node "${id}" presentation icon must be a non-empty string`);
  const size = presentation.preferredBodySize;
  if (size && (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0)) {
    fail(label, `node "${id}" preferred Body size must be positive and finite`);
  }
}

function validateJsonValue(value: unknown, label: string, path: string, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(label, `${path} contains a non-finite number`);
    return;
  }
  if (!value || typeof value !== "object") fail(label, `${path} is not JSON-serializable`);
  if (ancestors.has(value)) fail(label, `${path} contains a cycle`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => validateJsonValue(child, label, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail(label, `${path} must contain plain JSON objects`);
    for (const [key, child] of Object.entries(value)) {
      validateJsonValue(child, label, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function exactRefConflict(
  ref: ExactNodeTypeRef,
  existing: NodeContributionSource,
  incoming: NodeContributionSource,
): NodeCatalogValidationError {
  return new NodeCatalogValidationError(
    `exact node ref "${ref.nodeTypeId}@${ref.nodeTypeVersion}" from source "${formatContributionSource(incoming)}" conflicts with source "${formatContributionSource(existing)}"`,
  );
}

function exactKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}\u0000${ref.nodeTypeVersion}`;
}

function fail(source: string, detail: string): never {
  throw new NodeCatalogValidationError(`invalid node definition from source "${source}": ${detail}`);
}

function freezeDefinition(definition: CatalogNodeDefinition): void {
  Object.freeze(definition.ref);
  definition.inputs.forEach(Object.freeze);
  definition.outputs.forEach(Object.freeze);
  Object.freeze(definition.inputs);
  Object.freeze(definition.outputs);
  Object.freeze(definition.capabilities);
  if (definition.dataRequirements) Object.freeze(definition.dataRequirements);
  if (definition.config) {
    definition.config.migrations?.forEach(Object.freeze);
    if (definition.config.migrations) Object.freeze(definition.config.migrations);
    freezeData(definition.config.defaultValue);
    Object.freeze(definition.config);
  }
  if (definition.documentation) Object.freeze(definition.documentation);
  if (definition.presentation?.preferredBodySize) Object.freeze(definition.presentation.preferredBodySize);
  if (definition.presentation) Object.freeze(definition.presentation);
  Object.freeze(definition);
}

function freezeData(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  if (Array.isArray(value)) value.forEach(freezeData);
  else Object.values(value).forEach(freezeData);
  Object.freeze(value);
}
