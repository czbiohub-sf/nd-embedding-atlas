/** A group level's header, as in the table and the gallery: field, value, obs count, indented by level. */

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@ndea/ui/lib/utils";
import { groupKey, groupLabel, type TableItem } from "./fields";

export const LEVEL_INDENT = 14;

export function GroupHeader({
  item,
  field,
  onToggle,
  className,
  style,
}: {
  item: Extract<TableItem, { kind: "group" }>;
  /** The level's group field. */
  field: string | undefined;
  onToggle(key: string): void;
  className?: string;
  style?: CSSProperties;
}) {
  const { group, level, collapsed } = item;
  const value = group.values.slice(-1);
  return (
    <button
      type="button"
      className={cn("absolute top-0 left-0 flex items-center text-left font-sans hover:bg-muted", className)}
      style={style}
      onClick={() => onToggle(groupKey(group.values))}
    >
      {/* Sticky so the value stays in view when the view scrolls sideways. */}
      <span
        className="sticky left-0 flex w-fit items-center gap-2 px-1.5"
        style={{ paddingLeft: 6 + level * LEVEL_INDENT }}
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 text-text-muted" />
        ) : (
          <ChevronDownIcon className="size-3 text-text-muted" />
        )}
        {field ? <span className="font-mono text-2xs text-text-muted">{field}</span> : null}
        <span className={cn("font-medium", value[0] === null && "text-text-muted")}>{groupLabel(value)}</span>
        <span className="font-mono text-text-muted text-xs">{group.count.toLocaleString("en-US")} obs</span>
      </span>
    </button>
  );
}
