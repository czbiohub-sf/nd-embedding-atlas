import { exactNodeTypeRef } from "@ndea/sdk";

import { assetNodeTypeId, parseNodeAssetDefinition, type NodeAssetDefinition } from "./schema";

/** Node-asset schema versions migrate independently from asset semantic versions. */
export function migrateNodeAssetDefinition(value: unknown): NodeAssetDefinition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("node asset document must be an object");
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (schemaVersion !== 1) {
    throw new Error(`unsupported node asset schema version ${String(schemaVersion)}`);
  }
  return parseNodeAssetDefinition(value);
}

/** Explicit Edit Definition starts a detached draft; publishing never mutates the source definition. */
export function draftNextNodeAssetVersion(
  published: NodeAssetDefinition,
  assetVersion: string,
  changes: Partial<Pick<NodeAssetDefinition, "title" | "documentation" | "presentation" | "visibility">> = {},
): NodeAssetDefinition {
  return parseNodeAssetDefinition({
    ...published,
    ...changes,
    assetVersion,
    nodeTypeRef: exactNodeTypeRef(assetNodeTypeId(published.assetId), assetVersion),
  });
}
