/** Named version axes that advance independently. */
import packageJson from "../package.json";

declare const SDK_VERSION_BRAND: unique symbol;
declare const NODE_ASSET_VERSION: unique symbol;
declare const WORKSPACE_DOCUMENT_VERSION: unique symbol;

export type SDKVersion = string & { readonly [SDK_VERSION_BRAND]: true };
export type NodeAssetVersion = string & { readonly [NODE_ASSET_VERSION]: true };
export type WorkspaceDocumentVersion = number & {
  readonly [WORKSPACE_DOCUMENT_VERSION]: true;
};

export function sdkVersion(value: string): SDKVersion {
  return value as SDKVersion;
}

export function nodeAssetVersion(value: string): NodeAssetVersion {
  return value as NodeAssetVersion;
}

export function workspaceDocumentVersion(value: number): WorkspaceDocumentVersion {
  return value as WorkspaceDocumentVersion;
}

export const SDK_VERSION = sdkVersion(packageJson.version);

export function sdkMajor(version: SDKVersion): string {
  return version.split(".")[0] ?? "";
}
