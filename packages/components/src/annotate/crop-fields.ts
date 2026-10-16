import type { Metadata } from "@ndea/protocol";
import type { CropFields } from "./AnnotateTable";

type CropFieldMetadata = Pick<Metadata, "obs_columns" | "spatial">;

/** Resolve crop-addressable observation columns without treating a well grouping as an image path. */
export function resolveAnnotateCropFields(metadata: CropFieldMetadata): CropFields | null {
  const columns = metadata.obs_columns ?? [];
  const resolve = (declared: string | null | undefined, conventional: string): string | undefined => {
    const candidate = declared ?? (columns.includes(conventional) ? conventional : undefined);
    return candidate && columns.includes(candidate) ? candidate : undefined;
  };

  const fov = resolve(metadata.spatial?.crop_fov_col, "fov_name");
  const t = resolve(metadata.spatial?.t_col, "t");
  if (!fov || !t) return null;
  const z = metadata.spatial?.z_col;

  return {
    fov,
    t,
    dataset: columns.includes("_dataset") ? "_dataset" : undefined,
    z: z && columns.includes(z) ? z : undefined,
    x: resolve(metadata.spatial?.x_col, "x"),
    y: resolve(metadata.spatial?.y_col, "y"),
  };
}
