/** Workspace presentation and registration extensions to the SDK node contract. */

import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { NdPortKind } from "@/components/nd/nd-port";
import type { GraphNodeCookFunction } from "@/core/graph/cook";
import type { GraphNodeRegistrationContext } from "@/core/graph/evaluator";
import type { GraphDocumentNode, GraphNodeRole, GraphNodeType } from "@/core/graph/records";
import { getNode, listNodes, type AppGraphNodeSpec } from "@/core/node/registry";
import type { WorkspaceNodeSize } from "./types";

export interface WorkspaceNodeGeometry {
  chipW: number;
  card: WorkspaceNodeSize;
  full: WorkspaceNodeSize;
  canFull: boolean;
}

export interface WorkspaceNodeSpec<C = unknown> extends AppGraphNodeSpec {
  config?: ZodType<C>;
  configVersion?: number;
  type: GraphNodeType;
  kind: GraphNodeRole;
  pluginId?: string | null;
  evaluationRole: "source" | "transform" | "view";
  cook: GraphNodeCookFunction;
  registerEvaluation?(context: GraphNodeRegistrationContext): void;
  Body?: ComponentType<{ node: GraphDocumentNode }>;
  geometry: WorkspaceNodeGeometry;
  stage: "stageable" | "pin-only" | "canvas-only";
  inPalette: boolean;
  accent?: string;
  checkpoint?: boolean;
}

export function inputPortKindsOf(definition: AppGraphNodeSpec): NdPortKind[] {
  return definition.inputs.map((port) => port.kind as NdPortKind);
}

export function outputPortKindOf(definition: AppGraphNodeSpec): NdPortKind {
  return (definition.outputs[0]?.kind as NdPortKind) ?? "pred";
}

export function defineWorkspaceNodeSpec<C>(definition: WorkspaceNodeSpec<C>): WorkspaceNodeSpec<C> {
  return definition;
}

export function isWorkspaceNodeSpec(definition: AppGraphNodeSpec | undefined): definition is WorkspaceNodeSpec {
  return !!definition && "cook" in definition && typeof definition.cook === "function";
}

export function getWorkspaceNodeSpec(type: string): WorkspaceNodeSpec | undefined {
  const definition = getNode(type);
  return isWorkspaceNodeSpec(definition) ? definition : undefined;
}

export function listWorkspaceNodeSpecs(): WorkspaceNodeSpec[] {
  return listNodes().filter(isWorkspaceNodeSpec);
}
