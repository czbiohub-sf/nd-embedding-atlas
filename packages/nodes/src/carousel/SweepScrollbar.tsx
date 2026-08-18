/**
 * A slim horizontal scrollbar for the sweep, driven by Embla's own state.
 *
 * Deliberately NOT shadcn's `ScrollArea`: that component measures a natively
 * overflowing element (`scrollWidth` / `scrollLeft`) and renders a thumb from
 * those numbers. Embla does not overflow — it translates the track with a
 * `transform`, so the viewport's scrollWidth equals its clientWidth and a
 * ScrollArea scrollbar would compute a full-width thumb that never moves.
 *
 * So the bar reads Embla instead: `scrollProgress()` for position and the snap
 * count for thumb width, and scrubbing maps a fraction back to the nearest snap
 * through `scrollTo`. That keeps one source of truth, so it stays correct
 * alongside the arrows, keyboard, card taps and the group stepper.
 *
 * Embla's `scroll` event fires on every animation frame while the strip moves,
 * so the thumb's offset is written straight to the node's `style.left` instead
 * of being held in state. Only the width goes through React: it follows the
 * snap count, which changes just on `reInit`.
 */

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@ndea/ui/lib/utils";
import type { CarouselApi } from "@ndea/ui/components/carousel";

export interface SweepScrollbarProps {
  api: CarouselApi;
  /** Total slides, used to size the thumb when snaps are unavailable. */
  slideCount: number;
  className?: string;
}

/**
 * Thumb width as a fraction of the track: one snap per scroll position, so the
 * thumb covers the visible fraction, floored so it never vanishes on a long
 * sweep.
 */
function thumbFractionFor(snapCount: number) {
  const visible = snapCount > 0 ? Math.min(1, 1 / snapCount) : 1;
  return Math.max(visible, 0.06);
}

export function SweepScrollbar({ api, slideCount, className }: SweepScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [snapCount, setSnapCount] = useState(0);
  // Mirrors snapCount for the per-frame handler below, which must not be torn
  // down and re-subscribed every time the snap count changes.
  const snapCountRef = useRef(0);

  const applyThumbOffset = useCallback(() => {
    const thumb = thumbRef.current;
    if (!api || !thumb) return;
    // clamp: Embla reports slightly outside 0..1 while rubber-banding.
    const progress = Math.min(1, Math.max(0, api.scrollProgress()));
    thumb.style.left = `${progress * (1 - thumbFractionFor(snapCountRef.current)) * 100}%`;
  }, [api]);

  useEffect(() => {
    if (!api) return;
    // The snap list only changes when Embla re-initialises (slides added,
    // removed or resized), so it is read there and never per frame.
    const syncSnaps = () => {
      const count = api.scrollSnapList().length;
      snapCountRef.current = count;
      setSnapCount(count);
      applyThumbOffset();
    };
    syncSnaps();
    api.on("scroll", applyThumbOffset);
    // select settles the thumb on the snap an arrow, keyboard or stepper jumped to.
    api.on("select", applyThumbOffset);
    api.on("reInit", syncSnaps);
    return () => {
      api.off("scroll", applyThumbOffset);
      api.off("select", applyThumbOffset);
      api.off("reInit", syncSnaps);
    };
  }, [api, applyThumbOffset]);

  // A new snap count changes the thumb width, and with it the travel the offset
  // maps onto, so re-place the thumb once that width has committed.
  useEffect(() => {
    applyThumbOffset();
  }, [applyThumbOffset, snapCount]);

  const thumbFraction = thumbFractionFor(snapCount);

  const scrubTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!api || !track || snapCount === 0) return;
      const rect = track.getBoundingClientRect();
      // Aim the CENTRE of the thumb at the cursor, so the grab point does not
      // jump to the left edge on press.
      const usable = rect.width * (1 - thumbFraction);
      if (usable <= 0) return;
      const raw = (clientX - rect.left - (rect.width * thumbFraction) / 2) / usable;
      const target = Math.round(Math.min(1, Math.max(0, raw)) * (snapCount - 1));
      api.scrollTo(target);
    },
    [api, snapCount, thumbFraction],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      scrubTo(event.clientX);
    },
    [scrubTo],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // buttons is a bitmask: 1 means the primary button is still held.
      if ((event.buttons & 1) === 0) return;
      scrubTo(event.clientX);
    },
    [scrubTo],
  );

  if (!api || slideCount <= 1) return null;

  return (
    <div
      ref={trackRef}
      // biome-ignore lint/a11y/noStaticElementInteractions: a scrollbar duplicates
      // navigation already reachable via the arrows, keyboard and group stepper.
      className={cn("group/scrollbar h-2 shrink-0 cursor-pointer px-1 py-0.5", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <div className="relative h-1 w-full rounded-full bg-border/60">
        <div
          ref={thumbRef}
          className="absolute inset-y-0 rounded-full bg-foreground/35 transition-colors group-hover/scrollbar:bg-foreground/60"
          style={{ width: `${thumbFraction * 100}%` }}
        />
      </div>
    </div>
  );
}
