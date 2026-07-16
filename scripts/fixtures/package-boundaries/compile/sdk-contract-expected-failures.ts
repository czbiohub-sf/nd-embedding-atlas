import {
  defineNode,
  exactNodeTypeRef,
  nodeConfigVersion,
  nodeAssetVersion,
  nodeTypeVersion,
  PluginManifestSchemaVersionSchema,
  PluginPackageVersionSchema,
  sdkVersion,
  SDKVersionRangeSchema,
  workspaceDocumentVersion,
  type DataCapability,
  type NodeAvailability,
  type NodeCapability,
  type NodeConfigVersion,
  type NodeConfigSnapshot,
  type NodeModule,
  // @ts-expect-error NodeSpec was retired from the public barrel.
  type NodeSpec,
  type NodeTypeVersion,
  type PluginManifestSchemaVersion,
  type PluginPackageVersion,
  type PluginPermission,
  type SDKVersion,
  type SDKVersionRange,
} from "@ndea/sdk";

const manifestSchema = PluginManifestSchemaVersionSchema.parse(1);
const pluginPackage = PluginPackageVersionSchema.parse("1.0.0");
const sdkRange = SDKVersionRangeSchema.parse("^1.0.0");
const sdk = sdkVersion("1.0.0");
const nodeType = nodeTypeVersion("1.0.0");
const asset = nodeAssetVersion("1.0.0");
const documentVersion = workspaceDocumentVersion(1);

// @ts-expect-error SDK and node-type versions are distinct axes.
const wrongNodeType: NodeTypeVersion = sdk;
// @ts-expect-error Node-type and SDK versions are distinct axes.
const wrongSDK: SDKVersion = nodeType;
// @ts-expect-error Config and document versions are distinct axes.
const wrongConfig: NodeConfigVersion = documentVersion;
// @ts-expect-error Asset and SDK versions are distinct axes.
const wrongAsset: SDKVersion = asset;
// @ts-expect-error Manifest-schema and config versions are distinct axes.
const wrongManifest: NodeConfigVersion = manifestSchema;
// @ts-expect-error Plugin-package and node-type versions are distinct axes.
const wrongPluginPackage: NodeTypeVersion = pluginPackage;
// @ts-expect-error SDK ranges and exact SDK versions are distinct axes.
const wrongSDKRange: SDKVersion = sdkRange;
// @ts-expect-error Exact SDK versions cannot stand in for manifest schema versions.
const wrongManifestFromSDK: PluginManifestSchemaVersion = sdk;
// @ts-expect-error Node-type versions cannot stand in for plugin-package versions.
const wrongPackageFromNode: PluginPackageVersion = nodeType;
// @ts-expect-error Plugin-package versions cannot stand in for SDK ranges.
const wrongRangeFromPackage: SDKVersionRange = pluginPackage;

const wrongNodeSnapshot: NodeConfigSnapshot = {
  // @ts-expect-error Node-type and config versions are distinct axes.
  version: nodeType,
  value: null,
};
const wrongDocumentSnapshot: NodeConfigSnapshot = {
  // @ts-expect-error Document and config versions are distinct axes.
  version: documentVersion,
  value: null,
};
const validConfigSnapshot: NodeConfigSnapshot = {
  version: nodeConfigVersion(0),
  value: null,
};

declare const permission: PluginPermission;
declare const dataCapability: DataCapability;
declare const availability: NodeAvailability;
// @ts-expect-error Manifest permission disclosures are not host capabilities.
const permissionAsCapability: NodeCapability = permission;
// @ts-expect-error Dataset facts are not host capabilities.
const dataAsCapability: NodeCapability = dataCapability;
// @ts-expect-error Availability results are not host capabilities.
const availabilityAsCapability: NodeCapability = availability;

defineNode({
  ref: exactNodeTypeRef("fixture/read-only", "1.0.0"),
  title: "Read only",
  role: "view",
  inputs: [],
  outputs: [],
  capabilities: ["data-read"],
  load: () =>
    Promise.resolve<NodeModule<unknown, "data-read">>({
      createRuntime(host) {
        // @ts-expect-error GPU service was not declared by this definition.
        void host.acquireDeviceLease();
        return { dispose() {} };
      },
    }),
});

// @ts-expect-error SDK internals are not exported as package subpaths.
import type { NodeDefinition as DeepNodeDefinition } from "@ndea/sdk/node";

void wrongNodeType;
void wrongSDK;
void wrongConfig;
void wrongAsset;
void wrongManifest;
void wrongPluginPackage;
void wrongSDKRange;
void wrongManifestFromSDK;
void wrongPackageFromNode;
void wrongRangeFromPackage;
void wrongNodeSnapshot;
void wrongDocumentSnapshot;
void validConfigSnapshot;
void permissionAsCapability;
void dataAsCapability;
void availabilityAsCapability;
void (0 as unknown as NodeSpec);
void (0 as unknown as DeepNodeDefinition);
