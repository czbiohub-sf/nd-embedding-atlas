import type { ExactNodeTypeRef, PluginFactory } from "@ndea/sdk";
import { createNodeCatalog, type NodeCatalog } from "@/core/plugin/catalog";
import { NATIVE_NODE_SOURCE } from "@/core/plugin/registration";
import type { GraphNodeType } from "@/core/graph/records";
import {
  externalWorkspaceNodeSpecOf,
  workspaceNodeDescriptorOf,
  workspaceNodeSpecOf,
  type WorkspaceNodeLibrary,
  type WorkspaceNodeSpec,
} from "./node-projection";
import { NATIVE_NODE_CONTRIBUTIONS, NATIVE_NODE_DEFINITIONS } from "@/core/node/native-nodes";
import type { AnyNativeNodeContribution } from "@/core/node/native-contribution";

/** The one registration-only factory for every app-owned node definition. */
export const nativePluginFactory: PluginFactory = ({ registerNode }) => {
  for (const definition of NATIVE_NODE_DEFINITIONS) registerNode(definition);
};

/**
 * Projects one frozen session catalog into Workspace-owned graph and
 * presentation policy. Native definitions get their tuple-owned policy;
 * validated external definitions get the generic portable policy.
 */
export function createWorkspaceNodeLibrary(
  catalog: NodeCatalog,
  nativeContributions: readonly AnyNativeNodeContribution[] = NATIVE_NODE_CONTRIBUTIONS,
): WorkspaceNodeLibrary {
  const nativeByRef = new Map(
    nativeContributions.map((contribution) => [refKey(contribution.definition.ref), contribution]),
  );
  const specs: WorkspaceNodeSpec[] = [];

  for (const definition of catalog.listDefinitions()) {
    const entry = catalog.entryExact(definition.ref);
    if (!entry) throw new Error(`catalog lost source for ${refKey(definition.ref)}`);

    if (entry.source.kind === "native") {
      const contribution = nativeByRef.get(refKey(definition.ref));
      if (!contribution) throw new Error(`native node ${refKey(definition.ref)} has no Workspace policy`);
      specs.push(workspaceNodeSpecOf(contribution));
      continue;
    }

    if (catalog.resolveCurrent(definition.ref.nodeTypeId) === definition) {
      specs.push(externalWorkspaceNodeSpecOf(definition));
    }
  }

  const frozenSpecs = Object.freeze(specs);
  const specsByType = new Map<GraphNodeType, WorkspaceNodeSpec>();
  for (const spec of frozenSpecs) {
    if (specsByType.has(spec.type)) throw new Error(`duplicate Workspace node type "${spec.type}"`);
    specsByType.set(spec.type, spec);
  }

  const descriptors = Object.freeze(frozenSpecs.map(workspaceNodeDescriptorOf));
  const descriptorsByType = new Map(descriptors.map((descriptor) => [descriptor.type, descriptor]));
  const palette = Object.freeze(descriptors.filter(({ inPalette }) => inPalette));

  return Object.freeze({
    catalog,
    getSpec: (type: string) => specsByType.get(type),
    getDescriptor: (type: string) => descriptorsByType.get(type),
    listSpecs: () => frozenSpecs,
    listDescriptors: () => descriptors,
    paletteDescriptors: () => palette,
  });
}

/** Test/support helper. Runtime boot owns its catalog through NodeCatalogRegistration. */
export function createNativeWorkspaceNodeLibrary(): WorkspaceNodeLibrary {
  const catalog = createNodeCatalog([
    {
      source: NATIVE_NODE_SOURCE,
      definitions: NATIVE_NODE_DEFINITIONS,
    },
  ]);
  return createWorkspaceNodeLibrary(catalog);
}

function refKey(ref: ExactNodeTypeRef): string {
  return `${ref.nodeTypeId}@${ref.nodeTypeVersion}`;
}
