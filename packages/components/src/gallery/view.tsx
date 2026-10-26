/**
 * Gallery body: the obs as image crops. The table's obs engine (`useObsView`)
 * and toolbar do search, filter, sort, group, captions (Fields) and selection;
 * the gallery lays crops out as a grid or as strips, sizes and zooms them, and
 * colors each crop's strip by the color-by link's column as the scatter does.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { capabilitiesOf } from "@ndea/sdk";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ndea/ui/components/select";
import { Segmented } from "@ndea/ui/components/toggle-group";
import type { BodyProps } from "../contracts";
import { categoryMappingQuery } from "../query/category-mapping";
import { isGroupable } from "../table/fields";
import { Toolbar } from "../table/Toolbar";
import { useObsView } from "../table/useObsView";
import type { Row } from "../table/useTableQuery";
import type { GalleryColorServices, GalleryConfig, GalleryServices } from "./contracts";
import type { CropStyle } from "./CropTile";
import { CropGrid } from "./CropGrid";
import { CropStrips } from "./CropStrips";
import { useGalleryChannels } from "./useGalleryChannels";

/** The color-by link's categorical column → a strip color per row, matching the scatter's default palette. */
function useColorStrip(host: BodyProps<GalleryConfig>["host"], services: GalleryColorServices) {
  const subscribe = useCallback((cb: () => void) => host.colorBy.subscribe(cb), [host]);
  const get = useCallback(() => (host.colorBy.linked ? host.colorBy.get() : null), [host]);
  const column = useSyncExternalStore(subscribe, get);
  // ponytail: categorical columns only, in the scatter's default palette; a continuous column or a palette
  // picked in the scatter's legend shows no strip until the link shares its colormap.
  const { data } = useQuery(categoryMappingQuery(host.data.coordinator, column, services.categorize));
  const palette = useMemo(
    () => (data ? services.getCategoricalPalette(services.pickDefaultCategoricalPalette(data.n), data.n) : []),
    [data, services],
  );
  const indexColumn = data && palette.length ? data.mapping.indexColumn : null;
  const colorOf = useCallback(
    (row: Row) => {
      const index = indexColumn === null ? null : row[indexColumn];
      return typeof index === "number" ? palette[index % palette.length] : null;
    },
    [indexColumn, palette],
  );
  return { indexColumn, colorOf };
}

export function GalleryView({ host, services }: BodyProps<GalleryConfig> & { services: GalleryServices }) {
  const [config, setConfig] = useState<GalleryConfig>(host.config);
  const patch = useCallback(
    (next: Partial<GalleryConfig>) => {
      host.patchConfig(next);
      setConfig((c) => ({ ...c, ...next }));
    },
    [host],
  );
  const color = useColorStrip(host, services.color);
  const extra = useMemo(
    () => [config.columnsBy, color.indexColumn].filter((c): c is string => c !== null),
    [config.columnsBy, color.indexColumn],
  );
  const view = useObsView(host, { columns: config.columns, emptyShowsAll: false, groupBy: config.groupBy, extra });

  const { metadata } = services.dataset;
  const hasPlate = capabilitiesOf(metadata).has("plate-image");
  const { channels, hash, isPending, viewerZ } = useGalleryChannels(
    "docked",
    300,
    metadata.plate_channels,
    services.dataset,
  );
  const style: CropStyle = {
    size: config.size,
    zoom: config.zoom,
    caption: config.caption,
    fields: view.visibleFields,
    channels,
    hash,
    viewerZ,
    enabled: hasPlate && !isPending && channels.length > 0,
  };

  if (!view.fields) return <div className="h-full w-full bg-surface" />;
  const fields = view.fields;
  // A group field is constant along a strip, so it can't spread a strip into columns.
  const columnable = fields.filter((f) => isGroupable(f.type) && !view.groupBy.includes(f.name));
  const shown = view.visibleNames.length;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface text-ui">
      <Toolbar
        view={view}
        values={view.values}
        onGroup={(groupBy) => {
          view.setCollapsed(new Set());
          patch({ groupBy });
        }}
        fieldsLabel={shown ? `Fields · ${shown}` : "Fields"}
        fieldsActive={shown > 0}
        onColumns={(next) => patch({ columns: next ?? fields.map((f) => f.name) })}
      >
        {config.layout === "strips" ? (
          <Select
            items={[
              { value: null, label: "Columns: in sort order" },
              ...columnable.map((f) => ({ value: f.name, label: `Columns: ${f.name}` })),
            ]}
            value={config.columnsBy}
            onValueChange={(columnsBy) => patch({ columnsBy })}
          >
            <SelectTrigger
              size="sm"
              aria-label="Strip columns"
              title="How a strip's crops line up: one after another in sort order, or one shared column per value of a field (by t, a column is one timepoint in every strip)"
              className="max-w-44"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>In sort order</SelectItem>
              {columnable.map((f) => (
                <SelectItem key={f.name} value={f.name} className="font-mono">
                  One per {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Segmented
          label="Layout"
          value={config.layout}
          options={[
            { value: "grid", label: "Grid" },
            { value: "strips", label: "Strips" },
          ]}
          onChange={(layout) => patch({ layout })}
        />
      </Toolbar>
      {!hasPlate ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
          This dataset has no plate images to crop.
        </div>
      ) : config.layout === "grid" ? (
        <CropGrid view={view} style={style} colorOf={color.colorOf} />
      ) : (
        <CropStrips
          view={view}
          style={style}
          colorOf={color.colorOf}
          columnsBy={config.columnsBy && view.byName.has(config.columnsBy) ? config.columnsBy : null}
          coordinator={host.data.coordinator}
          table={host.data.table}
        />
      )}
    </div>
  );
}
