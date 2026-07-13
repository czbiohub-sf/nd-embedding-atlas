/** App-owned graph, presentation, and geometry policy for a native definition. */

import type { NodeCapability, NodeDefinition } from "@ndea/sdk";
import type { GraphNodeCookFunction } from "@/core/graph/cook";
import type { GraphNodeRole, GraphNodeType } from "@/core/graph/records";

export interface NativeNodeSize {
  readonly w: number;
  readonly h: number;
}

export interface NativeNodeGeometry {
  readonly chipW: number;
  readonly card: NativeNodeSize;
  readonly full: NativeNodeSize;
  readonly canFull: boolean;
}

export interface NativeNodePresentation {
  readonly geometry: NativeNodeGeometry;
  /** Forms that adopt the one mounted Body; omitted for body-less definitions. */
  readonly body?: "card-and-full" | "full-only";
  readonly stage: "stageable" | "pin-only" | "canvas-only";
  readonly inPalette: boolean;
  readonly accent?: string;
  readonly checkpoint?: boolean;
  readonly checkpointCreation?: boolean;
}

export interface NativeNodeContribution<
  Config = unknown,
  Capabilities extends readonly NodeCapability[] = readonly NodeCapability[],
> {
  /** Author-owned identity, ports, config, capabilities, module, and documentation. */
  readonly definition: NodeDefinition<Config, Capabilities>;
  /** App-owned graph evaluation and persisted-document compatibility. */
  readonly graph: {
    /** Only legacy graph identities that differ from the exact definition id set this. */
    readonly persistedType?: GraphNodeType;
    readonly role: GraphNodeRole;
    readonly evaluationRole: "source" | "transform" | "view";
    readonly cook: GraphNodeCookFunction;
  };
  /** Native Canvas and Stage policy kept outside the portable definition. */
  readonly presentation: NativeNodePresentation;
}

/** Existential contribution shape used only by heterogeneous native collections. */
// oxlint-disable-next-line no-explicit-any -- TypeScript has no existential generics; catalog validation checks erased entries.
export type AnyNativeNodeContribution = NativeNodeContribution<any, any>;

function freezeGeometry(geometry: NativeNodeGeometry): NativeNodeGeometry {
  return Object.freeze({
    ...geometry,
    card: Object.freeze({ ...geometry.card }),
    full: Object.freeze({ ...geometry.full }),
  });
}

export function defineNativeNodeContribution<Config, Capabilities extends readonly NodeCapability[]>(
  contribution: NativeNodeContribution<Config, Capabilities>,
): NativeNodeContribution<Config, Capabilities> {
  return Object.freeze({
    definition: contribution.definition,
    graph: Object.freeze({ ...contribution.graph }),
    presentation: Object.freeze({
      ...contribution.presentation,
      geometry: freezeGeometry(contribution.presentation.geometry),
    }),
  });
}
