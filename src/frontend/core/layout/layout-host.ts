/**
 * LayoutHost (PLUGIN-ARCHITECTURE §8) — one `openPlugin` replacing the four
 * imperative open paths (`addScatterPanel` / `togglePanel` / `addFloatingScatter`
 * / `openViewerPiP`). It reads `meta.placement` / `instancePolicy`, enforces the
 * GPU `maxInstances` soft cap against `DeviceBroker.liveLeases()` (decision #4),
 * and routes to the right container.
 *
 * Phase 1 routes the DOCKED container (Dockview) only; float/PiP keep their
 * existing stores until Phase 4. The `maxInstances` check reads
 * `deviceBroker.liveLeases()`, which becomes truthful once scatter acquires its
 * device through `host.acquireDeviceLease()` in Phase 2 (it is inert — always 0
 * — until then).
 */

import type { DockviewApi } from "dockview-react";
import { deviceBroker } from "@/core/gpu/device-broker";
import { getPlugin } from "@/core/plugin/registry";

let dockApi: DockviewApi | null = null;

/** DashboardShell registers the live Dockview API here on ready. */
export function registerDockApi(api: DockviewApi | null): void {
  dockApi = api;
}

export interface OpenPluginOpts {
  title?: string;
  params?: Record<string, unknown>;
}

function instanceSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Open (or focus) a plugin instance. Returns the instance id, or undefined if
 * the open was refused (unknown id, no dock api, cap reached, unrouted container).
 */
export function openPlugin(id: string, opts: OpenPluginOpts = {}): string | undefined {
  const descriptor = getPlugin(id);
  if (!descriptor) {
    console.warn(`openPlugin: unknown plugin "${id}"`);
    return undefined;
  }

  if (descriptor.placement.container !== "docked") {
    console.warn(`openPlugin: container "${descriptor.placement.container}" not yet routed (Phase 1 docks only)`);
    return undefined;
  }

  const api = dockApi;
  if (!api) return undefined;

  const multi = descriptor.instancePolicy === "multi";

  // singleton / unique-per-container → fixed id; focus an existing instance.
  if (!multi) {
    const existing = api.getPanel(id);
    if (existing) {
      existing.focus();
      return id;
    }
  }

  // GPU soft cap (truthful once scatter leases via the broker — Phase 2).
  if (multi && descriptor.maxInstances != null && descriptor.capabilities.has("gpu")) {
    if (deviceBroker.liveLeases() >= descriptor.maxInstances) {
      console.warn(`openPlugin: "${id}" is at maxInstances (${descriptor.maxInstances})`);
      return undefined;
    }
  }

  const instanceId = multi ? `${id}-${instanceSuffix()}` : id;
  const reference = api.panels.find((p) => p.id === id || p.id.startsWith(`${id}-`));
  api.addPanel({
    id: instanceId,
    component: id,
    title: opts.title ?? descriptor.title,
    params: opts.params,
    position: reference ? { referencePanel: reference.id, direction: "right" } : undefined,
  });
  return instanceId;
}
