import type { Metadata, ObsInfo } from "@ndea/protocol";

export function resolveObservationImage(
  metadata: Pick<Metadata, "plate_stores" | "dataset_keys" | "dataset_channels" | "plate_channels">,
  observation?: ObsInfo,
  datasetKey?: string,
) {
  if (!observation?.fov_name) return null;

  // Named datasets never fall back to another dataset's mount.
  const store =
    observation.dataset != null
      ? metadata.plate_stores?.find((candidate) => candidate.name === observation.dataset)
      : metadata.dataset_keys?.length
        ? undefined
        : metadata.plate_stores?.find((candidate) => candidate.name === "");
  if (!store || (datasetKey && store.name !== datasetKey)) return null;

  return {
    store,
    fovName: observation.fov_name,
    channels: store.name ? metadata.dataset_channels?.[store.name] : metadata.plate_channels,
  };
}
