import type { NodeBodyProps } from "@/core/node/app-node-host";

export function ObsBody(_: NodeBodyProps<unknown, never>) {
  return (
    <div className="font-mono text-3xs text-muted-foreground">
      atlas.obs
      <br />
      <span className="text-text-muted">all rows</span>
    </div>
  );
}
