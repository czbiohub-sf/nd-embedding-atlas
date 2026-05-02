/**
 * CollectionBadges — drift / synthetic-id / tag chips for a collection.
 *
 * Destructured props (not `collection: Collection`) so PR3 HoverCard
 * preview can render badges from a partial shape (e.g. before the full
 * Collection is hydrated from a search result).
 */

import { Badge } from "@/components/ui/badge";

export interface CollectionBadgesProps {
  /** All assigned tags. Renders as `<Badge variant="secondary">` chips. */
  tags: readonly string[];
  /** True when current_count < created_count. Renders an amber drift badge. */
  hasDrift?: boolean;
  /** Number of obs that fell out (created_count - current_count). Shown in title attr. */
  driftDelta?: number;
  /** True when provenance.synthetic_identity is set. Renders an amber caveat badge. */
  hasSyntheticIdentity?: boolean;
  /** Optional className passed to the wrapping flex container. */
  className?: string;
}

export function CollectionBadges({
  tags,
  hasDrift,
  driftDelta,
  hasSyntheticIdentity,
  className,
}: CollectionBadgesProps) {
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {hasDrift && (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/15 text-amber-400"
          title={driftDelta != null ? `${driftDelta} obs no longer present` : "Some members no longer present"}
        >
          drift{driftDelta != null ? ` · ${driftDelta}` : ""}
        </Badge>
      )}
      {hasSyntheticIdentity && (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-400"
          title="Dataset has no string obs_name column. Members are stored by row index — saved sets may not survive re-ingest if the row order changes."
        >
          synthetic id
        </Badge>
      )}
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {tag}
        </Badge>
      ))}
    </div>
  );
}
