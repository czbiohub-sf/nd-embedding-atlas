import type { NodeBodyProps as SharedNodeBodyProps } from "../contracts";

export type AnnotateCapabilities = "data-read" | "annotation-write" | "focus-coordination";
export type AnnotateConfig = { column: string | null; labels: string[]; mode?: "label" | "range" };
export type AnnotateOptions = Record<never, never>;
export type AnnotateBodyProps = SharedNodeBodyProps<AnnotateConfig, AnnotateCapabilities>;
