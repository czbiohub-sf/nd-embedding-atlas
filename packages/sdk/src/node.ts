import type { DataCapability, PluginPermission } from "@ndea/protocol";
import type { ZodType } from "zod";
import type { JsonValue } from "./json";
import type { NodeModule } from "./module";

declare const NODE_TYPE_ID: unique symbol;
declare const NODE_TYPE_VERSION: unique symbol;
declare const NODE_CONFIG_VERSION: unique symbol;
declare const NODE_INSTANCE_ID: unique symbol;
declare const ROW_INDEX: unique symbol;

export type NodeTypeId = string & { readonly [NODE_TYPE_ID]: true };
export type NodeTypeVersion = string & { readonly [NODE_TYPE_VERSION]: true };
export type NodeConfigVersion = number & { readonly [NODE_CONFIG_VERSION]: true };
export type NodeInstanceId = string & { readonly [NODE_INSTANCE_ID]: true };
export type RowIndex = number & { readonly [ROW_INDEX]: true };

export function nodeTypeId(value: string): NodeTypeId {
  return value as NodeTypeId;
}

export function nodeTypeVersion(value: string): NodeTypeVersion {
  return value as NodeTypeVersion;
}

export function nodeConfigVersion(value: number): NodeConfigVersion {
  return value as NodeConfigVersion;
}

export function nodeInstanceId(value: string): NodeInstanceId {
  return value as NodeInstanceId;
}

export function rowIndex(value: number): RowIndex {
  return value as RowIndex;
}

export interface ExactNodeTypeRef {
  readonly nodeTypeId: NodeTypeId;
  readonly nodeTypeVersion: NodeTypeVersion;
}

export function exactNodeTypeRef(nodeType: string, version: string): ExactNodeTypeRef {
  return {
    nodeTypeId: nodeTypeId(nodeType),
    nodeTypeVersion: nodeTypeVersion(version),
  };
}

export type PortKind = "pred" | "sel" | "focus";
export type FanInOperation = "and" | "or" | "diff";

export interface NodePort {
  readonly id: string;
  readonly kind: PortKind;
  readonly label: string;
  readonly multiple?: boolean;
  readonly fanIn?: FanInOperation;
  readonly documentation?: string;
}

/** A pull-time SQL predicate. `null` means all rows. */
export type PredicatePortValue = string | null;

/** An authored row set. `null` means absent; `[]` is an active empty set. */
export type RowSetPortValue = readonly RowIndex[] | null;

/** One focused dataset row. */
export type FocusPortValue = RowIndex | null;

export type NodePortValue = PredicatePortValue | RowSetPortValue | FocusPortValue;

export interface NodeComputeContext {
  readonly signal: AbortSignal;
  readonly epoch: number;
}

export type NodeComputeInputs = ReadonlyMap<string, readonly NodePortValue[]>;
export type NodeComputeOutputs = ReadonlyMap<string, NodePortValue>;
export type NodeCompute = (
  inputs: NodeComputeInputs,
  context: NodeComputeContext,
) => NodeComputeOutputs | Promise<NodeComputeOutputs>;

export interface NodeConfigMigration {
  readonly from: NodeConfigVersion;
  readonly to: NodeConfigVersion;
  migrate(config: JsonValue): JsonValue;
}

export interface NodeConfigContract<Config = unknown> {
  readonly schema: ZodType<Config>;
  readonly version: NodeConfigVersion;
  readonly defaultValue: Config;
  readonly migrations?: readonly NodeConfigMigration[];
}

export interface NodeConfigSnapshot {
  readonly version: NodeConfigVersion;
  readonly value: JsonValue;
}

export interface MigratedNodeConfig<Config> {
  readonly version: NodeConfigVersion;
  readonly value: Config;
}

export type NodeConfigMigrationErrorCode =
  | "future-version"
  | "invalid-migration-graph"
  | "missing-migrator"
  | "migration-failed"
  | "invalid-config";

export class NodeConfigMigrationError extends Error {
  readonly code: NodeConfigMigrationErrorCode;
  readonly sourceVersion: NodeConfigVersion;
  readonly targetVersion: NodeConfigVersion;

  constructor(
    code: NodeConfigMigrationErrorCode,
    sourceVersion: NodeConfigVersion,
    targetVersion: NodeConfigVersion,
    options?: ErrorOptions,
  ) {
    super(
      `Cannot migrate node config from version ${sourceVersion as number} to ${targetVersion as number}: ${code}.`,
      options,
    );
    this.name = "NodeConfigMigrationError";
    this.code = code;
    this.sourceVersion = sourceVersion;
    this.targetVersion = targetVersion;
  }
}

function indexNodeConfigMigrations(
  contract: NodeConfigContract,
  sourceVersion: NodeConfigVersion,
): ReadonlyMap<NodeConfigVersion, NodeConfigMigration> {
  const targetVersion = contract.version;
  const migrationsBySource = new Map<NodeConfigVersion, NodeConfigMigration>();

  if (!Number.isSafeInteger(targetVersion) || (targetVersion as number) < 0) {
    throw new NodeConfigMigrationError("invalid-migration-graph", sourceVersion, targetVersion);
  }

  for (const migration of contract.migrations ?? []) {
    const from = migration.from as number;
    const to = migration.to as number;
    if (
      !Number.isSafeInteger(from) ||
      from < 0 ||
      !Number.isSafeInteger(to) ||
      to <= from ||
      to > (targetVersion as number) ||
      typeof migration.migrate !== "function" ||
      migrationsBySource.has(migration.from)
    ) {
      throw new NodeConfigMigrationError("invalid-migration-graph", sourceVersion, targetVersion);
    }
    migrationsBySource.set(migration.from, migration);
  }

  return migrationsBySource;
}

export function migrateNodeConfig<Config>(
  contract: NodeConfigContract<Config>,
  snapshot: NodeConfigSnapshot,
): MigratedNodeConfig<Config> {
  const sourceVersion = snapshot.version;
  const targetVersion = contract.version;
  const migrationsBySource = indexNodeConfigMigrations(contract, sourceVersion);

  if ((sourceVersion as number) > (targetVersion as number)) {
    throw new NodeConfigMigrationError("future-version", sourceVersion, targetVersion);
  }

  let version = sourceVersion;
  let value = structuredClone(snapshot.value);
  while (version !== targetVersion) {
    const migration = migrationsBySource.get(version);
    if (!migration) {
      throw new NodeConfigMigrationError("missing-migrator", sourceVersion, targetVersion);
    }
    try {
      value = migration.migrate(value);
    } catch (cause) {
      throw new NodeConfigMigrationError("migration-failed", sourceVersion, targetVersion, { cause });
    }
    version = migration.to;
  }

  let parsedValue: Config;
  try {
    parsedValue = contract.schema.parse(value);
  } catch (cause) {
    throw new NodeConfigMigrationError("invalid-config", sourceVersion, targetVersion, { cause });
  }

  return Object.freeze({ version: targetVersion, value: parsedValue });
}

export type NodeCapability =
  | "data-read"
  | "predicate-publish"
  | "row-set-publish"
  | "row-set-subscribe"
  | "focus-coordination"
  | "view-coordination"
  | "schema-mutation"
  | "spatial-data"
  | "gpu-device"
  | "wasm-bitmap"
  | "compute"
  | "annotation-write"
  | "ordering-coordination"
  | "filter-coordination";

export interface NodeAvailabilityContext {
  readonly hostCapabilities: ReadonlySet<NodeCapability>;
  readonly dataCapabilities: ReadonlySet<DataCapability>;
  readonly grantedPermissions: ReadonlySet<PluginPermission>;
  readonly platform: "darwin" | "linux" | "win32";
}

export type NodeAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "host-capability" | "data-capability" | "permission" | "platform" | "dependency" | "disabled";
      readonly detail: string;
    };

export type NodeAvailabilityCheck = (context: NodeAvailabilityContext) => NodeAvailability;

export type NodeRole = "view" | "transform";

export interface NodeDocumentation {
  readonly summary: string;
  readonly use: string;
  readonly note?: string;
}

/** Portable author hints only. Canvas, Stage, and product layout policy stay app-local. */
export interface NodePresentationHints {
  readonly icon?: string;
  readonly preferredBodySize?: {
    readonly width: number;
    readonly height: number;
  };
}

/**
 * The single author-owned contract for one exact node type.
 *
 * Catalog provenance, product placement, graph records, and live instances are
 * deliberately absent. A host may add those concerns without copying fields.
 */
export interface NodeDefinition<
  Config = unknown,
  Capabilities extends readonly NodeCapability[] = readonly NodeCapability[],
> {
  readonly ref: ExactNodeTypeRef;
  readonly title: string;
  readonly role: NodeRole;
  readonly inputs: readonly NodePort[];
  readonly outputs: readonly NodePort[];
  readonly capabilities: Capabilities;
  readonly dataRequirements?: readonly DataCapability[];
  readonly config?: NodeConfigContract<Config>;
  readonly availability?: NodeAvailabilityCheck;
  readonly evaluate?: NodeCompute;
  readonly load?: () => Promise<NodeModule<Config, Capabilities[number]>>;
  readonly documentation?: NodeDocumentation;
  readonly presentation?: NodePresentationHints;
}

export function defineNode<Config, const Capabilities extends readonly NodeCapability[]>(
  definition: NodeDefinition<Config, Capabilities>,
): NodeDefinition<Config, Capabilities> {
  return definition;
}
