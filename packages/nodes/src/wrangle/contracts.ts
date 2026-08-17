import type { ComponentType } from "react";
import type { NodeHost } from "@ndea/sdk";
import type { PrqlError } from "./prql";

export interface WrangleConfig {
  prql?: string;
  predicateSql?: string | null;
}

export type WrangleCapabilities = "data-read";
export type WrangleNodeHost = NodeHost<WrangleConfig, WrangleCapabilities>;

export interface WrangleEditorProps {
  value: string;
  onChange(next: string): void;
  error?: PrqlError | null;
  placeholder?: string;
}

export type WrangleEditor = ComponentType<WrangleEditorProps>;
