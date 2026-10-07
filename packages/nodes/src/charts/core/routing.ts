/** Chart filter publication through the node-local coordination scope. */

import type { FilterClause } from "@ndea/protocol";
import type { FilterCoordinationAPI } from "@ndea/sdk";

type FilterPublishingHost = {
  readonly filter: Pick<FilterCoordinationAPI, "publish" | "clear">;
};

const CHART_FACET = "chart";

export function publishChartFilter(host: FilterPublishingHost, clause: FilterClause | null): void {
  if (clause == null) host.filter.clear(CHART_FACET);
  else host.filter.publish(CHART_FACET, clause);
}
