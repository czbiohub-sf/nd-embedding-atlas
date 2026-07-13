const COLUMN_WORKER_SOURCE_PATH = "packages/zarr/src/column-worker.ts";

export const COLUMN_WORKER_ENTRYPOINT = `./${COLUMN_WORKER_SOURCE_PATH}`;

export function columnWorkerUrl(): string {
  const isCompiled = Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0;
  return isCompiled
    ? `/$bunfs/root/${COLUMN_WORKER_SOURCE_PATH.replace(/\.ts$/, ".js")}`
    : new URL("./column-worker.ts", import.meta.url).href;
}
