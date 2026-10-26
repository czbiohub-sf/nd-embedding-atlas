/** Links (coordination scopes) of a workspace document: which exist, who joins them, what they hold. Pure. */

import { COORDINATION_TYPE_IDS, type CoordinationState, type CoordinationTypeId } from "../coordination/types";
import { allElements, elementScope, findElement, type DashboardElement, type LayoutDocument } from "./dashboard";

export interface Link {
  readonly type: CoordinationTypeId;
  readonly scope: string;
}

type LinkDocument = LayoutDocument & { readonly state: CoordinationState };

/** Every link in the document, or only those element `id` joins. */
export function documentLinks(document: LinkDocument, id?: string): Link[] {
  return COORDINATION_TYPE_IDS.flatMap((type) => {
    if (id === undefined) return Object.keys(document.state[type] ?? {}).map((scope) => ({ type, scope }));
    const scope = elementScope(findElement(document, id), type);
    return scope === undefined ? [] : [{ type, scope }];
  });
}

/** The elements (of every layout) that join `link`. */
export function linkMembers(document: LayoutDocument, { type, scope }: Link): [string, DashboardElement][] {
  return allElements(document).filter(([, element]) => elementScope(element, type) === scope);
}

/** What the link currently holds, in one phrase. */
export function linkValue(state: CoordinationState, { type, scope }: Link): string {
  switch (type) {
    case "filter": {
      const sources = Object.values(state.filter?.[scope] ?? {});
      const clauses = sources.reduce((sum, facets) => sum + Object.keys(facets).length, 0);
      return clauses === 0 ? "No selection" : clauses === 1 ? "1 clause" : `${clauses} clauses`;
    }
    case "focus": {
      const index = state.focus?.[scope];
      return index === null || index === undefined ? "Nothing focused" : `obs ${index.toLocaleString("en-US")}`;
    }
    case "colorBy":
      return state.colorBy?.[scope] ?? "No color";
    case "viewSync": {
      const zoom = state.viewSync?.[scope]?.zoom;
      return zoom === undefined ? "Not moved" : `Zoom ${zoom.toFixed(2)}`;
    }
    case "ordering": {
      const order = state.ordering?.[scope];
      return order ? `${order.col} ${order.dir}` : "Unsorted";
    }
  }
}
