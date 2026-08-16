/**
 * scatter: plugin-backed view (the `scatter` descriptor renders the body via
 * BodySocket). Cooks as a predicate pass-through; its lasso emission rides the push
 * port (sel), delivered downstream outside the cook. Out port is `sel`.
 */

import { createScatterDefinition } from "@ndea/nodes";
import type { ScatterServices } from "@ndea/nodes/scatter";
import { useColumnTypes } from "@ndea/nodes/query";
import { defineNativeNodeContribution } from "@/core/node/native-contribution";
import { passthroughGraphPredicate } from "@/core/graph/cook";
import { onDeviceLost } from "@/core/gpu/device-manager";
import { requireAppNodeHostFacet } from "@/core/node/app-node-host";
import { mountNodeBody } from "@/core/node/react-node-body";
import { useColormapList, useColormapPalette } from "@/hooks/useColormaps";
import { useDatasetSession } from "@/hooks/useDatasetSession";
import { useFocusedPointMeta } from "@/hooks/useFocusedPointMeta";
import { makeCategoryColumn } from "@/lib/color/category-column";
import { buildColormapLut } from "@/lib/color/ochre-lut";
import { getColormapList, pickDefaultCategoricalPalette } from "@/lib/color/ochre-palette";
import { WsReconnectError, wsClient } from "@/lib/ws-client";
import { pointRadiusStore } from "@/stores/point-radius-store";
import { renderSettingsStore } from "@/stores/render-settings-store";

const services: ScatterServices = {
  useSession: useDatasetSession,
  useFocusedPointMeta,
  useColumnTypes,
  useColormapList,
  useColormapPalette,
  getColormapList,
  categorize: makeCategoryColumn,
  buildColormapLut,
  pickDefaultCategoricalPalette,
  pointRadiusStore,
  renderSettingsStore,
  wsClient,
  isReconnectError: (error) => error instanceof WsReconnectError,
  onDeviceLost,
  createCheckpoint: (host) => requireAppNodeHostFacet(host, "checkpointCreation").create(),
  bodyHeaderElement: (host) => requireAppNodeHostFacet(host, "bodyHeaderElement"),
};

export const scatterDefinition = createScatterDefinition({
  mountBody: mountNodeBody,
  services,
});

export const scatterNode = defineNativeNodeContribution({
  definition: scatterDefinition,
  graph: {
    role: "view",
    evaluationRole: "view",
    cook: (inputs) => passthroughGraphPredicate(inputs),
  },
  presentation: {
    geometry: { chipW: 132, card: { w: 220, h: 156 }, full: { w: 420, h: 380 }, canFull: true },
    stage: "stageable",
    inPalette: true,
    body: "full-only",
    checkpointCreation: true,
    requiredHostFacets: ["checkpointCreation", "bodyHeaderElement"],
  },
});
