/**
 * Coordination types: ndea's registry over the workspace document's
 * json-render-style `state` section. Pure (Zod + protocol only) so the server
 * validates and composes coordination exactly like the browser.
 *
 * Layout: `state[type][scope]` holds one shared value, addressed by the JSON
 * Pointer `/<type>/<scope>`. A dashboard element joins a scope through a
 * json-render binding prop, `props[type] = { $bindState: "/<type>/<scope>" }`,
 * so an agent links views or drives them with plain JSON Patch.
 */

import { FilterClauseSchema, type FilterClause } from "@ndea/protocol";
import type { CoordinationType } from "@ndea/sdk";
import { z } from "zod";

import { filterClauseSql } from "@ndea/components/filter";

interface CoordinationTypeSpec {
  readonly label: string;
  readonly value: z.ZodType;
  readonly defaultValue: unknown;
}

/**
 * `filter` is a crossfilter: `source → facet → clause`. A member sees the AND
 * of every other source's clauses; sources need not be members (an agent
 * writes under its own key). Every other type is one latest-wins value.
 */
export const COORDINATION_TYPES = {
  focus: {
    label: "focus",
    value: z.number().int().nonnegative().nullable(),
    defaultValue: null,
  },
  filter: {
    label: "filter",
    value: z.record(z.string().min(1), z.record(z.string().min(1), FilterClauseSchema)),
    defaultValue: {},
  },
  colorBy: {
    label: "color",
    value: z.string().min(1).nullable(),
    defaultValue: null,
  },
  viewSync: {
    label: "view sync",
    value: z
      .object({
        panX: z.number(),
        panY: z.number(),
        zoom: z.number(),
        // Written by 3D scatters (turntable); 2D views ignore them.
        yaw: z.number().optional(),
        pitch: z.number().optional(),
        distance: z.number().positive().optional(),
        target: z.tuple([z.number(), z.number(), z.number()]).optional(),
        projection: z.enum(["perspective", "orthographic"]).optional(),
        src: z.string().optional(),
      })
      .strict(),
    defaultValue: { panX: 0, panY: 0, zoom: 1 },
  },
  ordering: {
    label: "sort",
    value: z
      .object({ col: z.string(), dir: z.enum(["asc", "desc"]) })
      .strict()
      .nullable(),
    defaultValue: null,
  },
} as const satisfies Record<CoordinationType, CoordinationTypeSpec>;

export type CoordinationTypeId = keyof typeof COORDINATION_TYPES;
export type CoordinationValue<T extends CoordinationTypeId> = z.infer<(typeof COORDINATION_TYPES)[T]["value"]>;
export type FilterScopeValue = CoordinationValue<"filter">;

export const COORDINATION_TYPE_IDS = Object.keys(COORDINATION_TYPES) as CoordinationTypeId[];

const SCOPE_RE = /^[A-Za-z0-9_-]+$/;

export type CoordinationState = { [T in CoordinationTypeId]?: Record<string, CoordinationValue<T>> };
export type CoordinationBinding = { readonly $bindState: string };

export const coordinationStateSchema = z
  .object(
    Object.fromEntries(
      COORDINATION_TYPE_IDS.map((type) => [
        type,
        z
          .record(
            z.string().regex(SCOPE_RE, "scope names use letters, digits, _ and -"),
            COORDINATION_TYPES[type].value,
          )
          .optional(),
      ]),
    ),
  )
  .strict() as z.ZodType<CoordinationState>;

export function isCoordinationType(type: string): type is CoordinationTypeId {
  return Object.hasOwn(COORDINATION_TYPES, type);
}

export function bindingPointer(type: CoordinationTypeId, scope: string): string {
  return `/${type}/${scope}`;
}

/** The scope a binding points at, or undefined when it is not `/<type>/<scope>`. */
export function bindingScope(type: CoordinationTypeId, binding: CoordinationBinding | undefined): string | undefined {
  const prefix = `/${type}/`;
  if (typeof binding?.$bindState !== "string" || !binding.$bindState.startsWith(prefix)) return undefined;
  const scope = binding.$bindState.slice(prefix.length);
  return SCOPE_RE.test(scope) ? scope : undefined;
}

/** Every clause a member of a filter scope sees: all sources except itself. */
export function filterScopeClauses(value: FilterScopeValue | undefined, elementId: string): FilterClause[] {
  if (!value) return [];
  return Object.entries(value).flatMap(([source, facets]) => (source === elementId ? [] : Object.values(facets)));
}

/**
 * `cell` with `source`'s `facet` set to `clause`; null clears it and a source
 * left without facets is dropped. Clearing an absent facet returns `cell` itself.
 */
export function setFilterFacet(
  cell: FilterScopeValue,
  source: string,
  facet: string,
  clause: FilterClause | null,
): FilterScopeValue {
  const { [source]: facets = {}, ...others } = cell;
  const { [facet]: previous, ...rest } = facets;
  if (clause === null && previous === undefined) return cell;
  const own = clause === null ? rest : { ...rest, [facet]: clause };
  return Object.keys(own).length > 0 ? { ...others, [source]: own } : others;
}

/** AND of compiled clauses, or null when there are none. */
export function filterClausesSql(clauses: readonly FilterClause[]): string | null {
  if (clauses.length === 0) return null;
  return clauses.map((clause) => `(${filterClauseSql(clause)})`).join(" AND ");
}
