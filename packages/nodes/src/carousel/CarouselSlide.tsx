/**
 * One slide: a single variant of the focused group, rendered by a LIVE idetik
 * viewport and nothing else.
 *
 * There is deliberately no server-rendered crop fallback. A carousel is not a
 * gallery: every slide the user can see is a real, camera-synced view of the
 * reconstruction, so the comparison is of actual pixels at actual zoom rather
 * than of two differently-produced images. It also removes the whole crop
 * pipeline from this node — roughly twenty POSTs and ~2 MB of base64 data URLs
 * per group, none of which the user was looking at.
 *
 * The slide element itself stays mounted for every peer regardless: Embla
 * measures slide nodes to build its snap list. What is windowed is the
 * VIEWPORT (see `use-sweep-stage`), which is where the GPU and network cost is.
 */

import { CheckIcon, XIcon } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { Button } from "@ndea/ui/components/button";
import { cn } from "@ndea/ui/lib/utils";
import type { GroupPeer } from "./use-group-peers";

/**
 * Pointer travel, in px, above which a gesture is a pan and not a click.
 *
 * A drag that starts and ends on the same element still fires `click`, so panning
 * an unselected card was selecting it on release — which then moved the carousel
 * out from under the gesture that had just finished.
 */
const CLICK_SLOP = 4;

export interface CarouselSlideProps {
  peer: GroupPeer;
  /** Formatted variant value shown under the view, e.g. "-2.33". */
  variantLabel: string;
  /** Effective label: optimistic overlay first, then the committed value. */
  label: string | null;
  /** Label vocabulary; the first two get the check/cross affordance. */
  labels: readonly string[];
  active: boolean;
  busy: boolean;
  /**
   * True once this slide's idetik viewport is attached and drawing. Until then
   * the box shows a streaming hint: there is no poster frame to fall back to.
   */
  live: boolean;
  /** Registers this slide's image box as an idetik viewport rect. */
  bindStage: (element: HTMLElement | null) => void;
  onLabel: (peer: GroupPeer, value: string) => void;
  onFocus: (peer: GroupPeer) => void;
}

export function CarouselSlide({
  peer,
  variantLabel,
  label,
  labels,
  active,
  busy,
  live,
  bindStage,
  onLabel,
  onFocus,
}: CarouselSlideProps) {
  // Selection rides POINTERUP, not click.
  //
  // A live slide's idetik controls listen with `passive: false` and call
  // preventDefault on pointerdown, which suppresses the synthesized click
  // entirely — a `click` handler never fires on a live card, so the card could
  // not be selected at all. pointerup still arrives.
  //
  // The slop check keeps panning from selecting: a drag that starts and ends on
  // the same element is otherwise indistinguishable from a tap.
  const downAtRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    downAtRef.current = { x: event.clientX, y: event.clientY };
  }, []);
  const selectIfTap = useCallback(
    (point: { clientX: number; clientY: number } | null) => {
      const downAt = downAtRef.current;
      downAtRef.current = null;
      if (downAt && point && Math.hypot(point.clientX - downAt.x, point.clientY - downAt.y) > CLICK_SLOP) return;
      onFocus(peer);
    },
    [onFocus, peer],
  );
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => selectIfTap(event), [selectIfTap]);
  // Keyboard activation produces a click with no preceding pointerdown.
  const onClick = useCallback(() => {
    if (downAtRef.current == null) selectIfTap(null);
  }, [selectIfTap]);

  const positive = labels[0];
  const negative = labels[1];

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-1 rounded-md border p-1 transition-colors",
        active ? "border-primary/70 bg-primary/5" : "border-border/50",
      )}
    >
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onClick}
        className="relative min-h-0 flex-1 overflow-hidden rounded-sm bg-black/40 focus-ring"
        title={peer.fovName ?? undefined}
      >
        {/*
         * The idetik viewport rect. It stays transparent: the shared canvas sits
         * BEHIND the carousel track and idetik scissors this element's box, so
         * anything painted here would cover the render.
         */}
        {/*
         * `data-sweep-live` is the drag arbitration marker. Embla's watchDrag
         * predicate refuses to start a track drag inside a live viewport, so a
         * drag on the picture pans the picture and a drag on the rail moves the
         * strip. Absent until the viewport attaches, so a still-loading slide
         * stays swipeable.
         */}
        <div ref={bindStage} data-sweep-live={live ? "" : undefined} className="absolute inset-0" />
        {live ? null : (
          <span className="absolute inset-0 flex items-center justify-center text-3xs text-text-muted">
            {peer.fovName ? "streaming…" : "no FOV"}
          </span>
        )}
        {label ? (
          <span
            className={cn(
              "absolute top-1 left-1 rounded-sm px-1 py-px text-3xs",
              label === negative ? "bg-destructive text-white" : "bg-success text-white",
            )}
          >
            {label}
          </span>
        ) : null}
        {live ? (
          <span className="absolute right-1 bottom-1 rounded-sm bg-black/50 px-1 py-px text-3xs text-white/80">
            live
          </span>
        ) : null}
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-3xs text-text-muted tabular-nums" title={variantLabel}>
          {variantLabel}
        </span>
        {positive ? (
          <Button
            variant={label === positive ? "default" : "outline"}
            size="icon-xs"
            disabled={busy}
            title={`mark ${positive}`}
            onClick={() => onLabel(peer, positive)}
          >
            <CheckIcon />
          </Button>
        ) : null}
        {negative ? (
          <Button
            variant={label === negative ? "default" : "outline"}
            size="icon-xs"
            disabled={busy}
            title={`mark ${negative}`}
            onClick={() => onLabel(peer, negative)}
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
