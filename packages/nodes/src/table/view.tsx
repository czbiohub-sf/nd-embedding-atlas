/**
 * Table plugin view (PLUGIN-ARCHITECTURE §10.4).
 *
 * Sources coordinator/table/metadata from `host.data`, the filter from
 * `host.filter.selection`, routes row-click through `host.focus.set`, and
 * reads focus reactively from the same host scope :
 * no `useDashboard` reach-in. `DataTable` is already fully prop-driven, so the
 * conversion is localized to this wrapper.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import type { RowIndex } from "@ndea/sdk";
import { CropThumb } from "../annotate/CropThumb";
import { resolveAnnotateCropFields } from "../annotate/crop-fields";
import { useGalleryChannels } from "../gallery/useGalleryChannels";
import { focusRow, publishOrdering, useNodeFocus } from "./routing";
import { DataTable } from "./DataTable";
import type { NodeBodyProps, TableCapabilities, TableConfig, TableServices } from "./contracts";
import type { Row } from "./useTableQuery";

/** The `ordering` coordination cell ⇄ TanStack `SortingState` bridge. */
type OrderingCell = { col: string; dir: "asc" | "desc" } | null;
const cellOf = (s: SortingState): OrderingCell => (s.length ? { col: s[0].id, dir: s[0].desc ? "desc" : "asc" } : null);
const sortingOf = (c: OrderingCell): SortingState => (c ? [{ id: c.col, desc: c.dir === "desc" }] : []);
const sameCell = (a: OrderingCell, b: OrderingCell): boolean => a?.col === b?.col && a?.dir === b?.dir;

const FALLBACK_TABLE_COLUMNS = ["_dataset"];

/** Crop locators are untyped DuckDB cells: normalize numeric DuckDB scalar widths. */
function numberAt(row: Row, column: string | undefined): number | null {
  const value = column ? row[column] : undefined;
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : null;
}

/** As `numberAt`, for the string locators (fov name, dataset key). */
function stringAt(row: Row, column: string | undefined): string | undefined {
  const value = column ? row[column] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function TableView({
  host,
  services,
}: NodeBodyProps<TableConfig, TableCapabilities> & { services: TableServices }) {
  const { coordinator, table, metadata } = host.data;
  const focusedRowIndex = useNodeFocus(host);

  const handleRowClick = useCallback(
    (nextFocusedRowIndex: RowIndex | null) => focusRow(host, nextFocusedRowIndex),
    [host],
  );

  // Sort ⇄ `ordering` coordination scope. Local when unscoped (host.ordering.set
  // is a no-op); shared when the node is on an ordering scope. The sameCell guard
  // breaks the echo when this node's own broadcast comes back through subscribe.
  const [sorting, setSorting] = useState<SortingState>(() => sortingOf(host.ordering?.get() ?? null));
  const handleSortingChange = useCallback(
    (next: SortingState) => {
      setSorting(next);
      publishOrdering(host, cellOf(next));
    },
    [host],
  );
  useEffect(() => {
    return host.ordering?.subscribe?.((cell) => {
      setSorting((prev) => (sameCell(cellOf(prev), cell) ? prev : sortingOf(cell)));
    });
  }, [host]);

  // Stable `columns` identity: metadata refresh (annotation writes) mints a
  // fresh `obs_columns` array; memoize so DataTable doesn't rebuild + re-fetch.
  const columns = useMemo(() => metadata.obs_columns ?? FALLBACK_TABLE_COLUMNS, [metadata.obs_columns]);

  // Row-detail crop media: shared "docked" slot (Table has no per-row focused
  // dataset the way Annotate does), so thumbnails stay contrasted/colored
  // identically to the Gallery node and the live viewer.
  const cropFields = useMemo(() => resolveAnnotateCropFields(metadata), [metadata]);
  const {
    channels: cropChannels,
    hash,
    viewerZ,
  } = useGalleryChannels("docked", 300, metadata.plate_channels, services);
  const renderRowMedia = useCallback(
    (row: Row) => {
      if (!cropFields) return null;
      const fovName = stringAt(row, cropFields.fov);
      if (!fovName) return null;
      const ri = row.__row_index__;
      if (ri == null) return null;
      return (
        <CropThumb
          fovName={fovName}
          t={numberAt(row, cropFields.t)}
          z={numberAt(row, cropFields.z)}
          rowIndex={Number(ri)}
          viewerZ={viewerZ}
          datasetKey={stringAt(row, cropFields.dataset)}
          channels={cropChannels}
          hash={hash}
          className="h-full w-full"
        />
      );
    },
    [cropFields, viewerZ, cropChannels, hash],
  );

  // Grouping lives in node config so it survives reload. Local state mirrors it
  // for an immediate response: `host.config` is a getter over a mutated object,
  // so patchConfig alone would not re-render until the graph recooked.
  const [groupBy, setGroupBy] = useState<string | null>(host.config.groupBy ?? null);
  const handleGroupByChange = useCallback(
    (next: string | null) => {
      setGroupBy(next);
      host.patchConfig({ groupBy: next });
    },
    [host],
  );

  return (
    <DataTable
      coordinator={coordinator}
      table={table}
      columns={columns}
      filter={host.filter}
      focusedRowIndex={focusedRowIndex}
      onRowClick={handleRowClick}
      sorting={sorting}
      onSortingChange={handleSortingChange}
      headerEl={services.bodyHeaderElement(host)}
      renderRowMedia={renderRowMedia}
      groupBy={groupBy}
      onGroupByChange={handleGroupByChange}
    />
  );
}
