import type { PluginBootstrapEntry, PluginDiagnostic } from "@ndea/protocol";
import type { PluginFactory } from "@ndea/sdk";
import { NodeCatalogRegistration, type NodeCatalog } from "./catalog";
import { freezePluginDiagnostics, pluginFailureDiagnostic } from "./diagnostics";
import {
  fetchPluginBootstrap,
  importPluginFactory,
  importPluginModule,
  type PluginBootstrapFetch,
  type PluginModuleImporter,
} from "./loader";
import { NATIVE_NODE_SOURCE, type NodeContributionSource, type PluginContributionBatch } from "./registration";
import { nativePluginFactory, createWorkspaceNodeLibrary } from "@/core/workspace/definitions";
import { assertExternalDefinitionWorkspaceSafe, type WorkspaceNodeLibrary } from "@/core/workspace/node-projection";

function aggregateSetupFailure(message: string, error: unknown, disposalError: unknown): AggregateError {
  return new AggregateError([error, disposalError], message, { cause: disposalError });
}

interface CatalogRegistration {
  register(
    source: NodeContributionSource,
    factory: PluginFactory,
    validateBatch?: (batch: PluginContributionBatch) => void,
  ): Promise<void>;
  freeze(): NodeCatalog;
  dispose(): void;
}

export interface FrontendPluginSession {
  readonly catalog: NodeCatalog;
  readonly nodeLibrary: WorkspaceNodeLibrary;
  readonly diagnostics: readonly PluginDiagnostic[];
  dispose(): void;
}

export interface FrontendPluginSessionDependencies {
  readonly fetch?: PluginBootstrapFetch;
  readonly importer?: PluginModuleImporter;
  readonly nativeFactory?: PluginFactory;
  readonly createRegistration?: () => CatalogRegistration;
}

/**
 * Builds the single immutable plugin/catalog/Workspace authority for one page
 * session. Every external source is collected and committed atomically.
 */
export async function loadFrontendPluginSession(
  dependencies: FrontendPluginSessionDependencies = {},
): Promise<FrontendPluginSession> {
  const registration = dependencies.createRegistration?.() ?? new NodeCatalogRegistration();
  const diagnostics: PluginDiagnostic[] = [];

  try {
    await registration.register(NATIVE_NODE_SOURCE, dependencies.nativeFactory ?? nativePluginFactory);

    let entries: readonly PluginBootstrapEntry[] = [];
    try {
      const bootstrap = await fetchPluginBootstrap(dependencies.fetch);
      entries = bootstrap.entries;
      diagnostics.push(...bootstrap.diagnostics);
    } catch (error) {
      diagnostics.push(pluginFailureDiagnostic(undefined, "bootstrap", "bootstrap-load-failed", error));
    }

    for (const entry of entries) {
      let factory: PluginFactory;
      try {
        factory = await importPluginFactory(entry.clientEntryUrl, dependencies.importer ?? importPluginModule);
      } catch (error) {
        diagnostics.push(pluginFailureDiagnostic(entry, "import", "client-entry-import-failed", error));
        continue;
      }

      try {
        await registration.register({ kind: "plugin", manifest: entry.manifest }, factory, (batch) => {
          for (const definition of batch.definitions) assertExternalDefinitionWorkspaceSafe(definition);
        });
      } catch (error) {
        diagnostics.push(pluginFailureDiagnostic(entry, "registration", "plugin-registration-failed", error));
      }
    }

    const catalog = registration.freeze();
    const nodeLibrary = createWorkspaceNodeLibrary(catalog);
    return Object.freeze({
      catalog,
      nodeLibrary,
      diagnostics: freezePluginDiagnostics(diagnostics),
      dispose: () => registration.dispose(),
    });
  } catch (error) {
    try {
      registration.dispose();
    } catch (disposalError) {
      throw aggregateSetupFailure("plugin session setup and disposal failed", error, disposalError);
    }
    throw error;
  }
}

export interface FrontendBootDependencies<Session extends { dispose(): void }> {
  loadSession(): Promise<Session>;
  initializeRoaring(): Promise<unknown>;
  mount(session: Session): void | (() => void) | Promise<void | (() => void)>;
}

export interface FrontendBoot<Session> {
  readonly session: Session;
  dispose(): void;
}

/** Explicit boot barrier: catalog freeze, then roaring, then the first React mount. */
export async function bootFrontend<Session extends { dispose(): void }>(
  dependencies: FrontendBootDependencies<Session>,
): Promise<FrontendBoot<Session>> {
  const session = await dependencies.loadSession();
  let mountDisposer: (() => void) | undefined;
  try {
    await dependencies.initializeRoaring();
    mountDisposer = (await dependencies.mount(session)) ?? undefined;
  } catch (error) {
    try {
      session.dispose();
    } catch (disposalError) {
      throw aggregateSetupFailure("frontend boot and plugin disposal failed", error, disposalError);
    }
    throw error;
  }

  let disposed = false;
  return Object.freeze({
    session,
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      try {
        mountDisposer?.();
      } catch (error) {
        errors.push(error);
      }
      try {
        session.dispose();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "frontend teardown failed");
    },
  });
}
