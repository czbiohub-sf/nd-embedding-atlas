import { describe, expect, test } from "bun:test";
import {
  PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  PluginManifestSchema,
  type PluginBootstrapCatalog,
  type PluginBootstrapEntry,
} from "@ndea/protocol";
import {
  SDK_VERSION,
  defineNode,
  exactNodeTypeRef,
  type NodeDefinition,
  type NodeModule,
  type PluginAPI,
  type PluginFactory,
} from "@ndea/sdk";
import { NATIVE_NODE_DEFINITIONS } from "@/core/node/native-nodes";
import { NodeCatalogRegistration } from "./catalog";
import type { PluginBootstrapFetch } from "./loader";
import { bootFrontend, loadFrontendPluginSession } from "./runtime";

const DIGESTS = ["a", "b", "c", "d", "e", "f"].map((character) => character.repeat(64));

function manifest(pluginId: string) {
  return PluginManifestSchema.parse({
    manifestSchemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
    pluginId,
    pluginPackageVersion: "1.0.0",
    sdkVersionRange: String(SDK_VERSION),
    displayName: pluginId,
    clientEntry: "client.js",
    hostCompatibility: { hostVersionRange: "*" },
    license: "MIT",
    permissions: [],
  });
}

function entry(pluginId: string, index: number, sourceId = `${pluginId}:${index}`): PluginBootstrapEntry {
  return {
    sourceId,
    manifest: manifest(pluginId),
    clientEntryUrl: `/plugins/${DIGESTS[index]}/client.js`,
    staticAssetUrls: {},
  };
}

function bootstrap(entries: readonly PluginBootstrapEntry[]): PluginBootstrapCatalog {
  return {
    schemaVersion: PLUGIN_BOOTSTRAP_SCHEMA_VERSION,
    entries: [...entries],
    diagnostics: [],
  };
}

function bootstrapFetch(value: unknown): PluginBootstrapFetch {
  return () =>
    Promise.resolve(new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
}

function definition(pluginId: string, name = "widget", overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return defineNode({
    ref: exactNodeTypeRef(`${pluginId}/${name}`, "1.0.0"),
    title: `${pluginId} ${name}`,
    role: "transform",
    inputs: [{ id: "in", kind: "pred", label: "Input" }],
    outputs: [{ id: "out", kind: "pred", label: "Output" }],
    capabilities: ["compute"] as const,
    evaluate: () => new Map([["out", null]]),
    presentation: { preferredBodySize: { width: 333, height: 222 } },
    ...overrides,
  });
}

function factory(...definitions: readonly NodeDefinition[]): PluginFactory {
  return ({ registerNode }) => {
    for (const value of definitions) registerNode(value);
  };
}

describe("frontend plugin session", () => {
  test("imports only validated bootstrap URLs and projects exact/current external definitions", async () => {
    const pluginEntry = entry("acme.widgets", 0);
    const externalModule: NodeModule = {};
    const prior = defineNode({
      ...definition("acme.widgets", "chart"),
      ref: exactNodeTypeRef("acme.widgets/chart", "0.9.0"),
    });
    const external = definition("acme.widgets", "chart", {
      load: () => Promise.resolve(externalModule),
    });
    const imported: string[] = [];

    const session = await loadFrontendPluginSession({
      fetch: bootstrapFetch(bootstrap([pluginEntry])),
      importer: (url) => {
        imported.push(url);
        return Promise.resolve({ default: factory(prior, external) });
      },
    });

    expect(imported).toEqual([pluginEntry.clientEntryUrl]);
    expect(session.catalog.resolveExact(external.ref)).toBe(external);
    expect(session.catalog.resolveExact(prior.ref)).toBe(prior);
    expect(session.catalog.resolveCurrent("acme.widgets/chart")).toBe(external);
    expect(session.nodeLibrary.listSpecs().filter(({ type }) => type === "acme.widgets/chart")).toHaveLength(1);
    const spec = session.nodeLibrary.getSpec("acme.widgets/chart");
    expect(spec?.geometry.full).toEqual({ w: 333, h: 222 });
    expect(spec?.stage).toBe("stageable");
    expect(spec?.inPalette).toBe(true);
    expect(spec?.pluginId).toBe("acme.widgets/chart");
    expect(
      spec?.cook(
        new Map([["in", [{ kind: "pred", sql: "value > 0" }]]]),
        { id: "chart-1", node: () => {}, frozenPredicate: () => {} },
        { signal: new AbortController().signal, epoch: 7 },
      ),
    ).toEqual({ kind: "pred", sql: null });
    expect(await external.load!()).toBe(externalModule);
    expect("Component" in externalModule).toBe(false);
    expect(session.diagnostics).toEqual([]);
    expect(Object.isFrozen(session.catalog)).toBe(true);
    expect(Object.isFrozen(session.nodeLibrary)).toBe(true);
    session.dispose();
  });

  test("diagnoses import, throwing, conflicting, and native-shadow sources without blocking later sources", async () => {
    const entries = [
      entry("broken.import", 0),
      entry("broken.throw", 1),
      entry("shared.plugin", 2, "shared:first"),
      entry("shared.plugin", 3, "shared:conflict"),
      entry("evil.shadow", 4),
      entry("healthy.plugin", 5),
    ];
    const shared = definition("shared.plugin");
    const healthy = definition("healthy.plugin");
    const modules = new Map<string, unknown>([
      [
        entries[1].clientEntryUrl,
        {
          default: ({ registerNode }: PluginAPI) => {
            registerNode(definition("broken.throw"));
            throw new Error("factory exploded");
          },
        },
      ],
      [entries[2].clientEntryUrl, { default: factory(shared) }],
      [entries[3].clientEntryUrl, { default: factory(definition("shared.plugin")) }],
      [
        entries[4].clientEntryUrl,
        {
          default: factory(
            defineNode({
              ...definition("evil.shadow"),
              ref: exactNodeTypeRef("cache", "1.0.0"),
            }),
          ),
        },
      ],
      [entries[5].clientEntryUrl, { default: factory(healthy) }],
    ]);

    const session = await loadFrontendPluginSession({
      fetch: bootstrapFetch(bootstrap(entries)),
      importer: (url) => {
        if (url === entries[0].clientEntryUrl) return Promise.reject(new Error("network import failed"));
        return Promise.resolve(modules.get(url));
      },
    });

    expect(session.catalog.resolveCurrent("shared.plugin/widget")).toBe(shared);
    expect(session.catalog.resolveCurrent("broken.throw/widget")).toBeUndefined();
    expect(session.catalog.resolveCurrent("healthy.plugin/widget")).toBe(healthy);
    expect(session.catalog.resolveCurrent("evil.shadow/widget")).toBeUndefined();
    expect(session.catalog.entryCurrent("cache")?.source.kind).toBe("native");
    expect(session.diagnostics.map(({ sourceId, stage }) => [sourceId, stage])).toEqual([
      ["broken.import:0", "import"],
      ["broken.throw:1", "registration"],
      ["shared:conflict", "registration"],
      ["evil.shadow:4", "registration"],
    ]);
    session.dispose();
  });

  test("rejects an unsafe definition atomically and continues with the next source", async () => {
    const unsafeEntry = entry("unsafe.plugin", 0);
    const healthyEntry = entry("healthy.plugin", 1);
    const safeButRolledBack = definition("unsafe.plugin", "safe");
    const missingEvaluation = definition("unsafe.plugin", "unsafe", { evaluate: undefined });
    const healthy = definition("healthy.plugin");
    let unsafeDisposed = false;
    const unsafeFactory: PluginFactory = ({ registerNode }) => {
      registerNode(safeButRolledBack);
      registerNode(missingEvaluation);
      return () => {
        unsafeDisposed = true;
      };
    };

    const session = await loadFrontendPluginSession({
      fetch: bootstrapFetch(bootstrap([unsafeEntry, healthyEntry])),
      importer: (url) =>
        Promise.resolve({
          default: url === unsafeEntry.clientEntryUrl ? unsafeFactory : factory(healthy),
        }),
    });

    expect(session.catalog.resolveCurrent("unsafe.plugin/safe")).toBeUndefined();
    expect(session.catalog.resolveCurrent("unsafe.plugin/unsafe")).toBeUndefined();
    expect(session.catalog.resolveCurrent("healthy.plugin/widget")).toBe(healthy);
    expect(unsafeDisposed).toBe(true);
    expect(session.diagnostics).toMatchObject([
      { sourceId: unsafeEntry.sourceId, stage: "registration", code: "plugin-registration-failed" },
    ]);
    session.dispose();
  });

  test("invalid or unavailable bootstrap degrades to native-only and never imports an unvalidated URL", async () => {
    let importCount = 0;
    const invalid = {
      ...bootstrap([]),
      entries: [{ ...entry("remote.plugin", 0), clientEntryUrl: "https://evil.test/client.js" }],
    };
    const invalidSession = await loadFrontendPluginSession({
      fetch: bootstrapFetch(invalid),
      importer: () => {
        importCount += 1;
        return Promise.resolve({});
      },
    });
    expect(importCount).toBe(0);
    expect(invalidSession.catalog.size).toBe(NATIVE_NODE_DEFINITIONS.length);
    expect(invalidSession.diagnostics).toMatchObject([{ stage: "bootstrap", code: "bootstrap-load-failed" }]);
    invalidSession.dispose();

    const unavailableSession = await loadFrontendPluginSession({
      fetch: () => Promise.reject(new Error("server unavailable")),
    });
    expect(unavailableSession.catalog.size).toBe(NATIVE_NODE_DEFINITIONS.length);
    expect(unavailableSession.diagnostics[0]).toMatchObject({ stage: "bootstrap" });
    unavailableSession.dispose();
  });

  test("freezes once and runs source disposers in reverse registration order", async () => {
    const calls: string[] = [];
    let freezeCount = 0;
    const registration = new NodeCatalogRegistration();
    const nativeFactory: PluginFactory = ({ registerNode }) => {
      for (const nativeDefinition of NATIVE_NODE_DEFINITIONS) registerNode(nativeDefinition);
      return () => calls.push("native");
    };
    const pluginFactory =
      (name: string, value: NodeDefinition): PluginFactory =>
      ({ registerNode }) => {
        registerNode(value);
        return () => calls.push(name);
      };
    const entries = [entry("first.plugin", 0), entry("second.plugin", 1)];

    const session = await loadFrontendPluginSession({
      fetch: bootstrapFetch(bootstrap(entries)),
      nativeFactory,
      importer: (url) =>
        Promise.resolve({
          default:
            url === entries[0].clientEntryUrl
              ? pluginFactory("first", definition("first.plugin"))
              : pluginFactory("second", definition("second.plugin")),
        }),
      createRegistration: () => ({
        register: (source, value, validateBatch) => registration.register(source, value, validateBatch),
        freeze: () => {
          freezeCount += 1;
          return registration.freeze();
        },
        dispose: () => registration.dispose(),
      }),
    });

    expect(freezeCount).toBe(1);
    session.dispose();
    session.dispose();
    expect(calls).toEqual(["second", "first", "native"]);
  });
});

describe("frontend boot barrier", () => {
  test("catalog freeze and roaring initialization finish before mount can reach Workspace/localStorage", async () => {
    const events: string[] = [];
    let releaseSession: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    const session = { dispose: () => events.push("session:dispose") };

    const bootPromise = bootFrontend({
      async loadSession() {
        events.push("catalog:start");
        await barrier;
        events.push("catalog:frozen");
        return session;
      },
      initializeRoaring() {
        events.push("roaring:ready");
        return Promise.resolve();
      },
      mount() {
        events.push("mount:workspace-local-storage");
        return () => events.push("mount:dispose");
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["catalog:start"]);
    releaseSession?.();
    const boot = await bootPromise;
    expect(events).toEqual(["catalog:start", "catalog:frozen", "roaring:ready", "mount:workspace-local-storage"]);
    boot.dispose();
    expect(events.slice(-2)).toEqual(["mount:dispose", "session:dispose"]);
  });

  test("teardown continues in reverse order when the mounted UI disposer fails", async () => {
    const events: string[] = [];
    const boot = await bootFrontend({
      loadSession: () => Promise.resolve({ dispose: () => events.push("session:dispose") }),
      initializeRoaring: () => Promise.resolve(),
      mount: () => () => {
        events.push("mount:dispose");
        throw new Error("unmount failed");
      },
    });

    expect(() => boot.dispose()).toThrow("unmount failed");
    expect(events).toEqual(["mount:dispose", "session:dispose"]);
  });
});
