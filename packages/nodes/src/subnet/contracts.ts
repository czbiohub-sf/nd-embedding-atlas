import type { ComponentType, MouseEvent } from "react";
import type { NodeHost } from "@ndea/sdk";

export type SubnetCapabilities = never;
export interface SubnetHierarchyService {
  getSnapshot(): { readonly childCount: number };
  subscribe(onChange: () => void): () => void;
  enter(): void;
}
export type SubnetHierarchyResolver = (host: NodeHost) => SubnetHierarchyService;
export type SubnetIconButton = ComponentType<{
  icon: "enter";
  label: string;
  title: string;
  onClick?: (event: MouseEvent) => void;
}>;
