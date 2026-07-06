/**
 * @ndea/plugin-sdk — the author-facing surface for writing a plugin descriptor
 * + its view/transform. In-tree plugins import from HERE (dogfood); a future
 * published npm package would re-export this same surface so external /
 * user-authored plugins target one stable, versioned contract.
 *
 * This barrel exposes ONLY what an author needs. Host-internal machinery (the
 * registry, the host shim, the buses, `DeviceLease`) is deliberately NOT
 * re-exported — a plugin reaches the host exclusively through the `NodeHost`
 * it is handed.
 */

import type { NodeSpec, NodeDescriptor } from "./types";
import { SDK_VERSION } from "./version";

// ── Descriptor layer (define your plugin) ──
export type {
  NodeSpec,
  NodeDescriptor,
  NodeMeta,
  NodeDoc,
  NodePort,
  DescriptorKind,
  NodeCapability,
  PortKind,
  FanInOp,
  NodePlacement,
  InstancePolicy,
  MountReason,
} from "./types";

// ── View / instance layer (write your Component / transform) ──
export type { NodeViewProps, NodeInstance, NodeModule } from "./types";

// ── Host API (what your Component holds; what per-call handlers receive) ──
export type {
  NodeHost,
  NodeContext,
  NodeSessionEvent,
  NodeInstanceId,
  DataContext,
  SelectionToken,
  DataApi,
  ViewSyncApi,
  HighlightApi,
  RenderApi,
  PanelContext,
  UiApi,
  OptionsBuilder,
} from "./host";
export { asInstanceId } from "./host";

// ── Serialization + capability vocabulary ──
export type { JsonValue } from "./json";
export type { DataCapability, Metadata } from "@/types";
export { capabilitiesOf, type DataCapabilitySet } from "@/lib/capabilities";

// ── Versioning ──
export { SDK_VERSION } from "./version";

/**
 * Author entry for a STATIC (in-tree / build-time) plugin: an identity helper
 * that stamps the current `SDK_VERSION` onto the descriptor when the author
 * didn't pin one, so descriptors stay terse and self-versioning.
 *
 *   export const fooDescriptor = defineDescriptor<FooConfig, FooOptions>({ id: "foo", ... });
 */
export function defineDescriptor<Config, Options>(
  descriptor: NodeDescriptor<Config, Options>,
): NodeDescriptor<Config, Options> {
  return descriptor.sdkVersion ? descriptor : { ...descriptor, sdkVersion: SDK_VERSION };
}

/**
 * Author entry for a BUILT-IN node spec — the identity helper paralleling
 * `defineDescriptor`. Built-ins extend `NodeSpec` workspace-side with an eager
 * cook + body (typed over the engine value); this preserves that full type `S`
 * while keeping the SDK base engine-agnostic. Register via `registerNode`
 * (in `core/workspace/nodes/index.ts`), mirroring `registerDescriptor`.
 *
 *   export const exportNode = defineNode({ id: "export", ... });
 */
export function defineNode<S extends NodeSpec>(spec: S): S {
  return spec;
}
