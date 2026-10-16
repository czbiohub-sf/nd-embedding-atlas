import type { Selection } from "@uwdata/mosaic-core";

export type CountPredicateToSql = (selection: Selection) => string | null;
