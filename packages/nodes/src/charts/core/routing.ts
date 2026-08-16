/** Chart filter publication through the node-local coordination scope. */

import type { FilterCoordinationAPI } from "@ndea/sdk";

type FilterPublishingHost = {
  readonly filter: Pick<FilterCoordinationAPI, "publish" | "clear">;
};

const CHART_FACET = "chart";

export function publishChartFilter(host: FilterPublishingHost, sql: string | null): void {
  if (sql == null) host.filter.clear(CHART_FACET);
  else host.filter.publish(CHART_FACET, sql);
}
