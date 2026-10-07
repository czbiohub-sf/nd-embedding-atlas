import type { ComponentType, MouseEvent } from "react";

export type CacheCapabilities = "data-read" | "filter-coordination" | "row-set-publish";

/** A pinned Cache holds its rows as a named observation set; `null` passes the live input through. */
export interface CacheConfig {
  readonly pin: { readonly clause: { readonly op: "inSet"; readonly set: string }; readonly count: number } | null;
}

export type CacheIconButton = ComponentType<{
  icon: "freeze";
  label: string;
  title: string;
  tone?: "amber";
  className?: string;
  onClick?: (event: MouseEvent) => void;
}>;
