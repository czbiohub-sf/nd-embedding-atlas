const CROP_WORKER_SOURCE_PATH = "apps/ndea/src/server/crop-worker.ts";

export const CROP_WORKER_ENTRYPOINT = `./${CROP_WORKER_SOURCE_PATH}`;

export function cropWorkerUrl(): string {
  const isCompiled = Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0;
  return isCompiled
    ? `/$bunfs/root/${CROP_WORKER_SOURCE_PATH.replace(/\.ts$/, ".js")}`
    : new URL("./crop-worker.ts", import.meta.url).href;
}
