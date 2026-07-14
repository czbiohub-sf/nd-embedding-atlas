// expect-error: @ndea/protocol/plugin

import type { PluginManifest } from "@ndea/protocol/plugin";

export type ForbiddenProtocolDeepImport = PluginManifest;
