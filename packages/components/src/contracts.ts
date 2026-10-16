import type { ComponentType } from "react";
import type { ComponentHost, MountedBody } from "@ndea/sdk";

export interface BodyProps<Config> {
  readonly host: ComponentHost<Config>;
}

export type BodyMounter = <Config>(
  component: ComponentType<BodyProps<Config>>,
  host: ComponentHost<Config>,
  title: string,
) => MountedBody;
