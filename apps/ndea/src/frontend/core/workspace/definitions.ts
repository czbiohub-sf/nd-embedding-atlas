import type { PluginFactory } from "@ndea/sdk";
import { createNodeCatalog, type NodeCatalog } from "@/core/plugin/catalog";
import { collectPluginContribution, NATIVE_NODE_SOURCE } from "@/core/plugin/registration";
import type { GraphNodeType } from "@/core/graph/records";
import {
  inputPortKindsOf,
  outputPortKindOf,
  workspaceNodeSpecOf,
  type WorkspaceNodeDescriptor,
  type WorkspaceNodeLibrary,
  type WorkspaceNodeSpec,
} from "./node-kit";
import { NATIVE_NODE_CONTRIBUTIONS, NATIVE_NODE_DEFINITIONS } from "./nodes";

/** The one registration-only factory for every app-owned node definition. */
export const nativePluginFactory: PluginFactory = ({ registerNode }) => {
  for (const definition of NATIVE_NODE_DEFINITIONS) registerNode(definition);
};

const nativeBatch = await collectPluginContribution(NATIVE_NODE_SOURCE, nativePluginFactory);

/** Immutable exact-ref authority for the native session contribution. */
export const nativeNodeCatalog: NodeCatalog = createNodeCatalog([nativeBatch]);

const NATIVE_NODE_SPECS = Object.freeze(NATIVE_NODE_CONTRIBUTIONS.map(workspaceNodeSpecOf));
const NATIVE_NODE_SPECS_BY_TYPE = new Map<GraphNodeType, WorkspaceNodeSpec>();
for (const spec of NATIVE_NODE_SPECS) {
  if (NATIVE_NODE_SPECS_BY_TYPE.has(spec.type)) {
    throw new Error(`duplicate native persisted node type "${spec.type}"`);
  }
  NATIVE_NODE_SPECS_BY_TYPE.set(spec.type, spec);
}

export function getWorkspaceNodeSpec(type: string): WorkspaceNodeSpec | undefined {
  return NATIVE_NODE_SPECS_BY_TYPE.get(type as GraphNodeType);
}

export function listWorkspaceNodeSpecs(): readonly WorkspaceNodeSpec[] {
  return NATIVE_NODE_SPECS;
}

function toWorkspaceNodeDescriptor(spec: WorkspaceNodeSpec): WorkspaceNodeDescriptor {
  return Object.freeze({
    type: spec.type,
    kind: spec.kind,
    label: spec.definition.title,
    pluginId: spec.pluginId,
    chipW: spec.geometry.chipW,
    card: spec.geometry.card,
    full: spec.geometry.full,
    canFull: spec.geometry.canFull,
    hasIn: spec.definition.inputs.length > 0,
    hasOut: spec.definition.outputs.length > 0,
    outKind: outputPortKindOf(spec),
    inKinds: Object.freeze(inputPortKindsOf(spec)),
    stage: spec.stage,
    inPalette: spec.inPalette,
  });
}

const WORKSPACE_NODE_DESCRIPTOR_LIST = Object.freeze(NATIVE_NODE_SPECS.map(toWorkspaceNodeDescriptor));
const WORKSPACE_NODE_DESCRIPTOR_BY_TYPE = new Map(
  WORKSPACE_NODE_DESCRIPTOR_LIST.map((descriptor) => [descriptor.type, descriptor]),
);
const WORKSPACE_PALETTE_NODE_DESCRIPTORS = Object.freeze(
  WORKSPACE_NODE_DESCRIPTOR_LIST.filter(({ inPalette }) => inPalette),
);

export function getWorkspaceNodeDescriptor(type: GraphNodeType): WorkspaceNodeDescriptor;
export function getWorkspaceNodeDescriptor(type: string): WorkspaceNodeDescriptor | undefined;
export function getWorkspaceNodeDescriptor(type: string): WorkspaceNodeDescriptor | undefined {
  return WORKSPACE_NODE_DESCRIPTOR_BY_TYPE.get(type as GraphNodeType);
}

export function listWorkspaceNodeDescriptors(): readonly WorkspaceNodeDescriptor[] {
  return WORKSPACE_NODE_DESCRIPTOR_LIST;
}

export function workspacePaletteNodeDescriptors(): readonly WorkspaceNodeDescriptor[] {
  return WORKSPACE_PALETTE_NODE_DESCRIPTORS;
}

/** Session-immutable node policy injected into Workspace and persistence boundaries. */
export const nativeWorkspaceNodeLibrary: WorkspaceNodeLibrary = Object.freeze({
  getSpec: getWorkspaceNodeSpec,
  getDescriptor: getWorkspaceNodeDescriptor,
});
