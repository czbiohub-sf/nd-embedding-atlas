import type { ZodType } from "zod";
import type { ComponentHost } from "./host";

declare const ROW_INDEX: unique symbol;

export type RowIndex = number & { readonly [ROW_INDEX]: true };

export function rowIndex(value: number): RowIndex {
  return value as RowIndex;
}

/** The workspace `state` coordination types a component can bind. */
export type CoordinationType = "focus" | "filter" | "colorBy" | "viewSync" | "ordering";

export interface ConfigContract<Config = unknown> {
  readonly schema: ZodType<Config>;
  readonly defaultValue: Config;
}

export interface ComponentDocumentation {
  readonly summary: string;
  readonly use: string;
  readonly note?: string;
}

export interface MountedBody {
  readonly element: HTMLElement;
  /** Must be safe to call more than once. */
  dispose(): void;
}

/** Lazy executable implementation, neutral to React or any other UI framework. */
export interface ComponentModule<Config = unknown> {
  mountBody(host: ComponentHost<Config>): MountedBody | Promise<MountedBody>;
}

/** One dashboard component: the element `type`, its docs, config contract, and lazy body. */
export interface ComponentDefinition<Config = unknown> {
  readonly type: string;
  readonly title: string;
  readonly documentation: ComponentDocumentation;
  readonly config?: ConfigContract<Config>;
  /** Coordination types the component can join; metadata for validation and agents, not a gate. */
  readonly binds: readonly CoordinationType[];
  readonly load: () => Promise<ComponentModule<Config>>;
}

export function defineComponent<Config>(definition: ComponentDefinition<Config>): ComponentDefinition<Config> {
  return definition;
}
