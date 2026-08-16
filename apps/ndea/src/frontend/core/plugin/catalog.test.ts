import { describe, expect, test } from "bun:test";
import {
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginManifestSchema,
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  type NodeCapability,
  type NodeDefinition,
  type PluginPermission,
} from "@ndea/sdk";
import { z } from "zod";
import { NodeCatalogBuilder, NodeCatalogRegistration, NodeCatalogValidationError, createNodeCatalog } from "./catalog";
import {
  NATIVE_NODE_SOURCE,
  type CatalogNodeDefinition,
  type NodeContributionSource,
  type PluginAuthorization,
  type PluginContributionBatch,
} from "./registration";
import { CAPABILITIES_BY_CATEGORY, CAPABILITY_DOCS } from "@/core/node/capability-docs";

function definition(id: string, version = "1.0.0", overrides: Partial<NodeDefinition<any>> = {}): NodeDefinition<any> {
  return defineNode({
    ref: exactNodeTypeRef(id, version),
    title: id,
    role: "transform",
    inputs: [],
    outputs: [],
    capabilities: [] as const,
    ...overrides,
  });
}

function source(
  pluginId: string,
  sdkVersionRange = String(SDK_VERSION),
  options: {
    readonly permissions?: readonly PluginPermission[];
  } = {},
): NodeContributionSource {
  return {
    kind: "plugin",
    manifest: PluginManifestSchema.parse({
      manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
      pluginId,
      pluginPackageVersion: "1.2.3",
      sdkVersionRange,
      displayName: pluginId,
      clientEntry: "index.js",
      hostCompatibility: { hostVersionRange: "*" },
      license: "MIT",
      permissions: (options.permissions ?? []).map((permission) => ({ permission, reason: `${permission} required` })),
    }),
  };
}

function authorizations(pluginId: string, authorization: PluginAuthorization) {
  return new Map([[pluginId, authorization]] as const);
}

function batch(sourceValue: NodeContributionSource, ...definitions: CatalogNodeDefinition[]): PluginContributionBatch {
  return { source: sourceValue, definitions };
}

describe("immutable node catalog", () => {
  test("documents every capability in exactly one semantic category", () => {
    const categorized: string[] = Object.values(CAPABILITIES_BY_CATEGORY).flat();
    expect(new Set(categorized).size).toBe(categorized.length);
    expect(categorized.toSorted()).toEqual(Object.keys(CAPABILITY_DOCS).toSorted());
  });

  test("resolves exact versions and the greatest current version without changing contribution order", () => {
    const old = definition("multi", "1.9.0");
    const latest = definition("multi", "2.0.0");
    const other = definition("other", "1.0.0", { role: "view" });
    const catalog = createNodeCatalog([batch(NATIVE_NODE_SOURCE, latest, other, old)]);

    expect(catalog.resolveExact(old.ref)).toBe(old);
    expect(catalog.resolveExact(exactNodeTypeRef("multi", "9.0.0"))).toBeUndefined();
    expect(catalog.resolveCurrent("multi")).toBe(latest);
    expect(catalog.listDefinitions()).toEqual([latest, other, old]);
    expect(catalog.listByRole("view")).toEqual([other]);
    expect(catalog.entryExact(old.ref)?.source).toEqual(NATIVE_NODE_SOURCE);
  });

  test("reports both sources for an exact-ref conflict and commits no part of the invalid batch", () => {
    const builder = new NodeCatalogBuilder();
    const firstSource = { kind: "native", sourceId: "native/first" } as const;
    const secondSource = { kind: "native", sourceId: "native/second" } as const;
    const first = definition("shared");
    const pending = definition("pending");
    builder.commit(batch(firstSource, first));

    expect(() => builder.commit(batch(secondSource, pending, definition("shared")))).toThrow(
      /source "native\/second" conflicts with source "native\/first"/,
    );

    const catalog = builder.freeze();
    expect(catalog.resolveCurrent("shared")).toBe(first);
    expect(catalog.resolveCurrent("pending")).toBeUndefined();
    expect(catalog.size).toBe(1);
  });

  test("rejects duplicate exact refs inside one batch atomically", () => {
    const builder = new NodeCatalogBuilder();
    expect(() => builder.commit(batch(NATIVE_NODE_SOURCE, definition("same"), definition("same")))).toThrow(
      NodeCatalogValidationError,
    );
    expect(builder.freeze().size).toBe(0);
  });

  test("enforces reserved and external namespaces", () => {
    const external = source("acme.widgets");
    expect(() => createNodeCatalog([batch(external, definition("ndea/scatter"))])).toThrow(/reserved "ndea\/"/);
    expect(() => createNodeCatalog([batch(external, definition("other/widget"))])).toThrow(
      /must be owned by "acme.widgets\/"/,
    );
    expect(() => createNodeCatalog([batch(external, definition("widget"))])).toThrow(
      /must be owned by "acme.widgets\/"/,
    );
    const externalDefinition = definition("acme.widgets/widget");
    const externalCatalog = createNodeCatalog([batch(external, externalDefinition)]);
    expect(externalCatalog.size).toBe(1);
    const registeredSource = externalCatalog.entryExact(externalDefinition.ref)?.source;
    expect(Object.isFrozen(registeredSource)).toBe(true);
    if (registeredSource?.kind === "plugin") {
      expect(Object.isFrozen(registeredSource.manifest)).toBe(true);
      expect(Object.isFrozen(registeredSource.manifest.permissions)).toBe(true);
    }

    const nativeOtherNamespace = definition("acme/widget");
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, nativeOtherNamespace)])).toThrow(
      /only use the reserved "ndea\/" namespace/,
    );
    expect(createNodeCatalog([batch(NATIVE_NODE_SOURCE, definition("ndea/widget"))]).size).toBe(1);
  });

  test("rejects incompatible SDK ranges before definitions commit", () => {
    const builder = new NodeCatalogBuilder();
    builder.commit(batch(NATIVE_NODE_SOURCE, definition("prior")));
    expect(() => builder.commit(batch(source("future", ">=999.0.0"), definition("future/widget")))).toThrow(
      /requires SDK ">=999.0.0"/,
    );
    expect(
      builder
        .freeze()
        .listDefinitions()
        .map((value) => String(value.ref.nodeTypeId)),
    ).toEqual(["prior"]);
  });

  test("validates capabilities and data requirements", () => {
    const duplicate = definition("duplicate-capability", "1.0.0", {
      capabilities: ["data-read", "data-read"],
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, duplicate)])).toThrow(
      /duplicates capability "data-read"/,
    );

    const unknownCapabilities = ["future-service"] as unknown as readonly NodeCapability[];
    const unknown = definition("unknown-capability", "1.0.0", { capabilities: unknownCapabilities });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, unknown)])).toThrow(
      /unknown capability "future-service"/,
    );
    const inheritedName = definition("inherited-capability", "1.0.0", {
      capabilities: ["toString"] as unknown as readonly NodeCapability[],
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, inheritedName)])).toThrow(
      /unknown capability "toString"/,
    );

    const missingDataRead = definition("missing-data-read", "1.0.0", {
      capabilities: [],
      dataRequirements: ["obs"],
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, missingDataRead)])).toThrow(
      /data requirements require capability "data-read"/,
    );

    for (const capability of ["annotation-write", "row-set-publish"] as const) {
      const missingImplication = definition(`missing-${capability}`, "1.0.0", {
        capabilities: [capability],
      });
      expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, missingImplication)])).toThrow(
        new RegExp(`capability "${capability}" requires capability "data-read"`),
      );
    }
  });

  test("keeps manifest requests separate from app authorization", () => {
    const gpuDefinition = definition("authorized.gpu/widget", "1.0.0", {
      capabilities: ["gpu-device"],
    });

    expect(() => createNodeCatalog([batch(source("authorized.gpu"), gpuDefinition)])).toThrow(
      /capability "gpu-device" requires manifest permission "gpu"/,
    );
    expect(() =>
      createNodeCatalog([
        batch(source("authorized.gpu", String(SDK_VERSION), { permissions: ["gpu"] }), gpuDefinition),
      ]),
    ).toThrow(/requests permission "gpu" without app authorization/);
    expect(() =>
      createNodeCatalog(
        [batch(source("authorized.gpu", String(SDK_VERSION), { permissions: ["gpu"] }), gpuDefinition)],
        authorizations("authorized.gpu", {
          grantedPermissions: ["gpu"],
          grantedCapabilities: [],
        }),
      ),
    ).toThrow(/capability "gpu-device" lacks app authorization/);

    const permitted = source("authorized.gpu", String(SDK_VERSION), { permissions: ["gpu"] });
    expect(
      createNodeCatalog(
        [batch(permitted, gpuDefinition)],
        authorizations("authorized.gpu", {
          grantedPermissions: ["gpu"],
          grantedCapabilities: ["gpu-device"],
        }),
      ).resolveCurrent("authorized.gpu/widget"),
    ).toBe(gpuDefinition);
  });

  test("requires deterministic declared config migrations and a valid default", () => {
    const schema = z.object({ count: z.number().int() });
    const gap = definition("migration-gap", "1.0.0", {
      config: {
        schema,
        version: nodeConfigVersion(3),
        defaultValue: { count: 3 },
        migrations: [
          { from: nodeConfigVersion(1), to: nodeConfigVersion(2), migrate: (value) => value },
          { from: nodeConfigVersion(3), to: nodeConfigVersion(4), migrate: (value) => value },
        ],
      },
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, gap)])).toThrow(/migration 1 must be 2 -> 3/);

    const missing = definition("migration-missing", "1.0.0", {
      config: { schema, version: nodeConfigVersion(2), defaultValue: { count: 2 } },
    });
    expect(createNodeCatalog([batch(NATIVE_NODE_SOURCE, missing)]).resolveCurrent("migration-missing")).toBe(missing);

    const invalidDefault = definition("invalid-default", "1.0.0", {
      config: { schema, version: nodeConfigVersion(1), defaultValue: { count: 1.5 } },
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, invalidDefault)])).toThrow(/invalid default config/);

    const transformingDefault = definition("non-json-transformed-default", "1.0.0", {
      config: {
        schema: z.object({ value: z.string() }).transform(({ value }) => new Date(value)),
        version: nodeConfigVersion(1),
        defaultValue: { value: "2024-01-01T00:00:00.000Z" } as never,
      },
    });
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, transformingDefault)])).toThrow(
      /parsed default config must contain plain JSON objects/,
    );
  });

  test("keeps app graph and layout policy out of SDK definitions", () => {
    const appDefinition = {
      ...definition("app-policy"),
      geometry: { width: 100, height: 100 },
    };
    expect(() => createNodeCatalog([batch(NATIVE_NODE_SOURCE, appDefinition)])).toThrow(
      /app-only or unknown field "geometry"/,
    );
  });

  test("freezes definitions, indexes, selectors, and further builder mutation", () => {
    const value = definition("frozen", "1.0.0", {
      config: {
        schema: z.object({ labels: z.array(z.string()) }),
        version: nodeConfigVersion(1),
        defaultValue: { labels: ["one"] },
      },
    });
    const builder = new NodeCatalogBuilder();
    builder.commit(batch(NATIVE_NODE_SOURCE, value));
    const catalog = builder.freeze();

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.listDefinitions())).toBe(true);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.config?.defaultValue)).toBe(true);
    expect(Reflect.set(value, "title", "changed")).toBe(false);
    expect(() => builder.commit(batch(NATIVE_NODE_SOURCE, definition("late")))).toThrow(/catalog is frozen/);
    expect(catalog.resolveCurrent("late")).toBeUndefined();
  });

  test("resolves exact and current definitions without owning module state", async () => {
    let loads = 0;
    const value = definition("loadable", "2.0.0", {
      load: () => {
        loads += 1;
        return Promise.resolve({ createRuntime: () => ({ dispose() {} }) });
      },
    });
    const catalog = createNodeCatalog([batch(NATIVE_NODE_SOURCE, value, definition("metadata-only"))]);

    expect(catalog.resolveExact(value.ref)).toBe(value);
    expect(catalog.resolveCurrent("loadable")).toBe(value);
    expect(catalog.resolveCurrent("missing")).toBeUndefined();
    expect(loads).toBe(0);

    await value.load!();
    await value.load!();
    expect(loads).toBe(2);
  });

  test("registration disposes a rejected batch, preserves prior batches, and closes in reverse", async () => {
    const calls: string[] = [];
    const registration = new NodeCatalogRegistration();
    await registration.register(NATIVE_NODE_SOURCE, ({ registerNode }) => {
      registerNode(definition("first"));
      return () => calls.push("first");
    });
    await registration.register(NATIVE_NODE_SOURCE, ({ registerNode }) => {
      registerNode(definition("second"));
      return () => calls.push("second");
    });

    await expect(
      registration.register({ kind: "native", sourceId: "native/invalid" }, ({ registerNode }) => {
        registerNode(definition("pending"));
        registerNode(definition("first"));
        return () => calls.push("invalid");
      }),
    ).rejects.toThrow(/native\/invalid.*ndea\/native/);
    expect(calls).toEqual(["invalid"]);

    const catalog = registration.freeze();
    expect(catalog.listDefinitions().map((value) => String(value.ref.nodeTypeId))).toEqual(["first", "second"]);
    await expect(
      registration.register(NATIVE_NODE_SOURCE, () => {
        calls.push("late");
      }),
    ).rejects.toThrow(/registration is frozen/);
    registration.dispose();
    registration.dispose();
    expect(calls).toEqual(["invalid", "second", "first"]);
  });
});
