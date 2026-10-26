/** One obs as a square crop: color strip, focus outline, selection check, caption fields. */

import { CheckIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@ndea/ui/lib/utils";
import { formatValue, type TableField } from "../table/fields";
import type { Row } from "../table/useTableQuery";
import type { ChannelDef, ChannelHash, GalleryConfig } from "./contracts";
import { useCrop } from "./useGalleryCropQuery";

/** Px per caption line under a crop. */
const CAPTION_LINE = 14;

/** Height a tile's captions add below the crop. */
export const captionHeight = (fields: readonly TableField[], caption: GalleryConfig["caption"]) =>
  caption === "below" && fields.length ? fields.length * CAPTION_LINE + 4 : 0;

export interface CropStyle {
  readonly size: number;
  readonly zoom: number;
  readonly caption: GalleryConfig["caption"];
  readonly fields: readonly TableField[];
  readonly channels: readonly ChannelDef[];
  readonly hash: ChannelHash;
  readonly viewerZ: number;
  /** False until the channels settle (or without plate images). */
  readonly enabled: boolean;
}

function Caption({ fields, data, className }: { fields: readonly TableField[]; data: Row; className?: string }) {
  return (
    <div className={cn("flex flex-col px-1 font-mono text-2xs", className)}>
      {fields.map((f) => (
        <span key={f.name} className="truncate" style={{ lineHeight: `${CAPTION_LINE}px` }}>
          {formatValue(data[f.name]) || <span className="text-text-faint">–</span>}
        </span>
      ))}
    </div>
  );
}

export function CropTile({
  row,
  data,
  style,
  color,
  focused,
  selected,
  extra = 0,
  onClick,
}: {
  row: number;
  data: Row;
  style: CropStyle;
  /** The color strip's color; null without a color-by link. */
  color: string | null;
  focused: boolean;
  selected: boolean;
  /** More obs in the same aligned cell (a +n badge). */
  extra?: number;
  onClick(event: MouseEvent): void;
}) {
  const { size, fields, caption } = style;
  const crop = useCrop({ row, ...style });
  const title = fields.map((f) => `${f.name}: ${formatValue(data[f.name])}`).join("\n") || undefined;
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="group flex cursor-pointer flex-col text-left outline-none"
      style={{ width: size }}
    >
      <span
        className={cn(
          "relative block overflow-hidden rounded-[3px] bg-black",
          focused ? "outline-2 outline-primary outline-offset-1" : "group-hover:outline-1 group-hover:outline-border",
        )}
        style={{ width: size, height: size }}
      >
        {crop.data ? (
          <img src={crop.data} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
        ) : (
          <span className={cn("absolute inset-0", crop.isError ? "bg-muted/40" : "animate-pulse bg-muted/20")} />
        )}
        {color ? <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: color }} /> : null}
        {selected ? (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-3" strokeWidth={3} />
          </span>
        ) : null}
        {extra > 0 ? (
          <span className="absolute top-1 left-1 rounded-sm bg-surface/85 px-1 font-mono text-2xs">+{extra}</span>
        ) : null}
        {caption === "overlay" && fields.length ? (
          <Caption
            fields={fields}
            data={data}
            className={cn(
              "absolute inset-x-0 bottom-[3px] bg-surface/85 py-0.5 opacity-0 transition-opacity group-hover:opacity-100",
              focused && "opacity-100",
            )}
          />
        ) : null}
      </span>
      {caption === "below" && fields.length ? (
        <Caption fields={fields} data={data} className={cn("pt-1", focused ? "text-primary" : "text-text-muted")} />
      ) : null}
    </button>
  );
}

/** A tile whose row hasn't loaded yet. */
export function TilePlaceholder({ size, height }: { size: number; height: number }) {
  return (
    <span className="block" style={{ width: size, height }}>
      <span className="block animate-pulse rounded-[3px] bg-muted/20" style={{ width: size, height: size }} />
    </span>
  );
}
