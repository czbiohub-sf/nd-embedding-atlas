/**
 * <PluginMount> (PLUGIN-ARCHITECTURE §8) — the single container-agnostic wrapper
 * that subsumes `ScatterPanel` / `TablePanel` / `ImageViewerPanel` /
 * `ChartGroupPanel` and (later) `FloatingScatterItem` / PiP. It:
 *   1. looks up the descriptor,
 *   2. `await descriptor.load()` (the lazy engine chunk) inside <Suspense>,
 *   3. builds a `PluginHost` for this instance via `useDashboardHostShim`,
 *   4. renders the resolved Component wrapped in `PanelErrorBoundary`.
 *
 * The host is built EXACTLY ONCE per mount (keyed by the stable `panel.id` =
 * `instanceId`) and disposed on unmount, so device/bitmap teardown is
 * single-owner.
 */

import { Suspense, use, useEffect, useState } from "react";
import { PanelErrorBoundary } from "@/components/layout/PanelErrorBoundary";
import { useDashboardHostShim } from "@/core/host/use-dashboard-host-shim";
import { asInstanceId, type PanelContext } from "@/core/plugin/host";
import { getPlugin } from "@/core/plugin/registry";
import type { JsonValue } from "@/core/plugin/json";
import type { MountReason, PluginModule } from "@/core/plugin/types";

/** Memoized lazy-load: each plugin's engine chunk is fetched at most once. */
const moduleCache = new Map<string, Promise<PluginModule>>();

function loadPluginModule(id: string): Promise<PluginModule> {
  let p = moduleCache.get(id);
  if (!p) {
    const descriptor = getPlugin(id);
    if (!descriptor) return Promise.reject(new Error(`unknown plugin: ${id}`));
    p = descriptor.load();
    moduleCache.set(id, p);
  }
  return p;
}

export interface PluginMountProps {
  id: string;
  panel: PanelContext;
  reason?: MountReason;
  /** Serializable config override merged over the module's `defaultConfig`. */
  config?: JsonValue;
}

export function PluginMount({ id, panel, reason = "fresh", config }: PluginMountProps) {
  const title = getPlugin(id)?.title ?? id;
  return (
    <PanelErrorBoundary panelName={title}>
      <Suspense fallback={<MountFallback title={title} />}>
        <PluginBody id={id} panel={panel} reason={reason} config={config} />
      </Suspense>
    </PanelErrorBoundary>
  );
}

function MountFallback({ title }: { title: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs">Loading {title}…</div>
  );
}

function PluginBody({
  id,
  panel,
  reason,
  config,
}: Required<Omit<PluginMountProps, "config">> & { config?: JsonValue }) {
  const module = use(loadPluginModule(id));
  const makeHost = useDashboardHostShim();

  const [handle] = useState(() =>
    makeHost<unknown, unknown>({
      instanceId: asInstanceId(panel.id),
      // descriptor is present: the module resolved, so its descriptor is registered.
      meta: getPlugin(id)!,
      reason,
      config: {
        ...(module.defaultConfig as Record<string, unknown>),
        ...(config as Record<string, unknown> | undefined),
      },
      options: {},
      panel,
    }),
  );

  useEffect(() => () => handle.dispose(), [handle]);

  const Component = module.Component;
  return <Component host={handle.host} />;
}
