import { exactNodeTypeRef, type ExactNodeTypeRef, type JsonValue, type PortKind } from "@ndea/sdk";

import type { GraphDocumentEdge, GraphDocumentNode } from "@/core/graph/records";
import {
  assetNodeTypeId,
  exactNodeAssetRefKey,
  exactNodeRefKey,
  nodeAssetId,
  nodeAssetVersion,
  parseNodeAssetDefinition,
  type NodeAssetDefinition,
  type NodeAssetDependency,
} from "./schema";

export interface NodeAssetParameterDraftBinding {
  readonly id: string;
  readonly label: string;
  readonly nodeId: string;
  readonly configPath: readonly string[];
  readonly defaultValue: JsonValue;
  readonly documentation?: string;
}

export interface CreateNodeAssetDraftOptions {
  readonly assetId: string;
  readonly assetVersion: string;
  readonly title: string;
  readonly selectedNodeIds: readonly string[];
  readonly nodes: Readonly<Record<string, GraphDocumentNode>>;
  readonly edges: Readonly<Record<string, GraphDocumentEdge>>;
  readonly resolveDefinition?: (ref: ExactNodeTypeRef) =>
    | {
        readonly outputs: readonly { readonly id: string; readonly label: string; readonly kind: PortKind }[];
      }
    | undefined;
  readonly parameters: readonly NodeAssetParameterDraftBinding[];
  readonly documentation?: NodeAssetDefinition["documentation"];
  readonly presentation?: NodeAssetDefinition["presentation"];
  readonly visibility?: NodeAssetDefinition["visibility"];
}

export function createNodeAssetDraftFromSubgraph(options: CreateNodeAssetDraftOptions): NodeAssetDefinition {
  if (options.selectedNodeIds.length === 0) throw new Error("node asset authoring requires a non-empty selection");
  const uniqueSelection = [...new Set(options.selectedNodeIds)].toSorted();
  if (uniqueSelection.length !== options.selectedNodeIds.length)
    throw new Error("node asset selection contains duplicates");
  const selected = uniqueSelection.map((id) => {
    const node = options.nodes[id];
    if (!node) throw new Error(`node asset selection references missing node "${id}"`);
    return node;
  });
  const parent = selected[0]?.parent ?? null;
  if (selected.some((node) => (node.parent ?? null) !== parent)) {
    throw new Error("node asset selection must live on one graph level");
  }
  const selectedIds = new Set(uniqueSelection);
  const localIdByNodeId = new Map(uniqueSelection.map((id, index) => [id, `node-${index + 1}`]));
  const dependencies: NodeAssetDependency[] = [];
  const dependencyKeys = new Set<string>();
  for (const node of selected) {
    const definitionRef = node.definitionRef;
    const dependency: NodeAssetDependency = definitionRef.nodeTypeId.startsWith("asset/")
      ? {
          kind: "asset",
          assetRef: {
            assetId: nodeAssetId(definitionRef.nodeTypeId.slice("asset/".length)),
            assetVersion: nodeAssetVersion(definitionRef.nodeTypeVersion),
          },
        }
      : { kind: "node", definitionRef };
    const key =
      dependency.kind === "node"
        ? `node:${exactNodeRefKey(dependency.definitionRef)}`
        : `asset:${exactNodeAssetRefKey(dependency.assetRef)}`;
    if (!dependencyKeys.has(key)) {
      dependencyKeys.add(key);
      dependencies.push(dependency);
    }
  }

  const edges = Object.values(options.edges);
  const innerEdges = edges
    .filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((edge, index) => ({
      id: `edge-${index + 1}`,
      from: localIdByNodeId.get(edge.from)!,
      fromPort: edge.fromPort,
      to: localIdByNodeId.get(edge.to)!,
      toPort: edge.toPort,
      kind: edge.kind,
    }));
  const incoming = edges
    .filter((edge) => !selectedIds.has(edge.from) && selectedIds.has(edge.to))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const outgoing = edges
    .filter((edge) => selectedIds.has(edge.from) && !selectedIds.has(edge.to))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const usedInputIds = new Set<string>();
  const inputs = incoming.map((edge) => {
    const id = uniquePortId(edge.toPort, usedInputIds);
    return {
      id,
      label: titleCase(id),
      kind: edge.kind,
      target: { nodeId: localIdByNodeId.get(edge.to)!, portId: edge.toPort },
    };
  });
  const usedOutputIds = new Set<string>();
  const outputs: {
    id: string;
    label: string;
    kind: PortKind;
    source: { nodeId: string; portId: string };
  }[] = outgoing.map((edge) => {
    const id = uniquePortId(edge.fromPort, usedOutputIds);
    return {
      id,
      label: titleCase(id),
      kind: edge.kind,
      source: { nodeId: localIdByNodeId.get(edge.from)!, portId: edge.fromPort },
    };
  });
  if (outputs.length === 0) {
    const innerSources = new Set(
      edges.filter((edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to)).map((edge) => edge.from),
    );
    for (const node of selected) {
      if (innerSources.has(node.id)) continue;
      const definition = options.resolveDefinition?.(node.definitionRef);
      if (!definition) throw new Error(`node asset output definition is unavailable for "${node.id}"`);
      for (const port of definition.outputs) {
        const id = uniquePortId(port.id, usedOutputIds);
        outputs.push({
          id,
          label: port.label,
          kind: port.kind,
          source: { nodeId: localIdByNodeId.get(node.id)!, portId: port.id },
        });
      }
    }
  }
  if (outputs.length === 0) throw new Error("node asset selection has no promotable output");
  const parameters = options.parameters.map((binding) => {
    const localId = localIdByNodeId.get(binding.nodeId);
    if (!localId) throw new Error(`promoted parameter "${binding.id}" targets a node outside the selection`);
    return {
      id: binding.id,
      label: binding.label,
      defaultValue: structuredClone(binding.defaultValue),
      target: { nodeId: localId, configPath: [...binding.configPath] },
      ...(binding.documentation ? { documentation: binding.documentation } : {}),
    };
  });

  return parseNodeAssetDefinition({
    schemaVersion: 1,
    assetId: options.assetId,
    assetVersion: options.assetVersion,
    nodeTypeRef: exactNodeTypeRef(assetNodeTypeId(options.assetId), options.assetVersion),
    title: options.title,
    dependencies,
    nodes: selected.map((node) => ({
      id: localIdByNodeId.get(node.id)!,
      definitionRef: node.definitionRef,
      ...(node.config ? { config: structuredClone(node.config) } : {}),
    })),
    edges: innerEdges,
    inputs,
    outputs,
    parameters,
    documentation: options.documentation ?? { summary: options.title },
    presentation: options.presentation ?? {},
    visibility: options.visibility ?? "public",
  });
}

function uniquePortId(candidate: string, used: Set<string>): string {
  const base = candidate.replace(/-(?:in|out)$/, "") || candidate;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

function titleCase(value: string): string {
  return value
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
