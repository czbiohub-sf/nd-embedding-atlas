import * as zarr from "zarrita";
import type { Convention, DataTree } from "./types.ts";
import { SimpleDataTree } from "./data-tree.ts";
import { SimpleCoordSet, SimpleCoordArray } from "./coord-set.ts";

/**
 * OME-Zarr (NGFF) convention parser.
 *
 * Detects: root .zattrs has "multiscales" key.
 * Dimensions come from multiscales[0].axes, NOT _ARRAY_DIMENSIONS.
 * Resolution levels at "0/", "1/", etc. with coordinateTransformations.
 */
export const detectOmeZarr: Convention = {
    name: "ome-zarr",

    detect(rootAttrs: Record<string, unknown>): boolean {
        return "multiscales" in rootAttrs;
    },

    async parse(group: any): Promise<DataTree> {
        const attrs = (group.attrs ?? {}) as Record<string, unknown>;
        const multiscales = attrs.multiscales as any[];
        if (!multiscales?.length) {
            throw new Error("OME-Zarr: multiscales metadata missing or empty");
        }

        const ms = multiscales[0];
        const axes: Array<{ name: string; type?: string; unit?: string }> = ms.axes ?? [];
        const datasets: Array<{
            path: string;
            coordinateTransformations?: Array<{
                type: string;
                scale?: number[];
                translation?: number[];
            }>;
        }> = ms.datasets ?? [];

        // Build root DataTree
        const root = new SimpleDataTree("", { attrs });

        // Each resolution level becomes a child with its own Dataset
        for (const ds of datasets) {
            const path = ds.path;
            const transforms = ds.coordinateTransformations ?? [];

            // Extract scale transform for coordinate generation
            const scaleTransform = transforms.find((t) => t.type === "scale");
            const translationTransform = transforms.find((t) => t.type === "translation");

            const scale = scaleTransform?.scale ?? axes.map(() => 1);
            const translation = translationTransform?.translation ?? axes.map(() => 0);

            // Open the zarr array at this path
            // zarrita: zarr.open(store, { kind: "array" }) for specific path
            // For now, store array reference lazily
            const levelAttrs: Record<string, unknown> = {
                _ome_axes: axes,
                _ome_scale: scale,
                _ome_translation: translation,
            };

            // Open the zarr array to get its shape, then compute coordinate arrays
            let arrayShape: number[] = [];
            try {
                const arr = await zarr.open(group.resolve(path), { kind: "array" });
                arrayShape = [...arr.shape];
            } catch {
                // Can't open array — coords will be empty (logged below)
            }

            const coords: SimpleCoordArray[] = [];
            for (let axIdx = 0; axIdx < axes.length; axIdx++) {
                const ax = axes[axIdx];
                const s = scale[axIdx];
                const t = translation[axIdx];
                const dimSize = arrayShape[axIdx] ?? 0;

                // Generate coordinate values: coord[i] = translation + i * scale
                const values = new Float64Array(dimSize);
                for (let i = 0; i < dimSize; i++) {
                    values[i] = t + i * s;
                }

                coords.push(
                    new SimpleCoordArray(ax.name, values, "float64", {
                        unit: ax.unit,
                        type: ax.type,
                        scale: s,
                        translation: t,
                    }),
                );
            }

            const coordSet = new SimpleCoordSet(coords);
            const dataset: any = {
                data_vars: new Map(),
                coords: coordSet,
                attrs: levelAttrs,
                async [Symbol.asyncDispose]() {},
            };

            const child = new SimpleDataTree(path, {
                dataset,
                attrs: levelAttrs,
                parent: root,
            });
            root.addChild(child);
        }

        return root;
    },
};
