import type { NodeHost } from "@ndea/sdk";
import type { Selection } from "@uwdata/mosaic-core";

export type CountCapabilities = "data-read";
export type CountPredicateToSql = (selection: Selection) => string | null;
export type CountNodeHost = NodeHost<unknown, CountCapabilities>;
