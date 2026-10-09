import { type RefObject, useEffect } from "react";

/**
 * Keeps a scroll container's offset across *silent* scroll resets.
 *
 * Node bodies are reparented with `appendChild` when a body moves between the
 * Canvas socket and a Stage tile. Moving a live subtree detaches and re-inserts
 * it, and the browser resets `scrollTop`/`scrollLeft` on the whole subtree
 * WITHOUT firing a scroll event. Anything tracking the offset in JS is then
 * stranded: TanStack Virtual reads offset only from scroll events
 * (`observeElementOffset`), so it keeps rendering the rows for the pre-reset
 * offset and translates them outside the visible band — a table that paints an
 * empty area until you nudge the wheel.
 *
 * A `ResizeObserver` is the signal: the reparent relayouts the container, and by
 * the time it fires the DOM offset has already been zeroed. Restoring the DOM
 * (rather than resyncing the virtualizer to 0) also keeps the user's place, and
 * the resulting scroll event resyncs every offset listener for free.
 */
export function useScrollRestore(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let wantTop = element.scrollTop;
    let wantLeft = element.scrollLeft;

    const onScroll = () => {
      // Our own restore echoes back as a scroll event; anything else is user intent.
      if (element.scrollTop === wantTop && element.scrollLeft === wantLeft) return;
      wantTop = element.scrollTop;
      wantLeft = element.scrollLeft;
    };
    element.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      if (element.scrollTop === wantTop && element.scrollLeft === wantLeft) return;
      // Mid-animation the container can be too short to hold the offset, and
      // assigning past the maximum would clamp and lose the position for good.
      // Skipping is safe: the pane settles with further resize callbacks.
      if (element.scrollHeight - element.clientHeight < wantTop) return;
      if (element.scrollWidth - element.clientWidth < wantLeft) return;
      element.scrollTop = wantTop;
      element.scrollLeft = wantLeft;
    });
    observer.observe(element);

    return () => {
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [ref]);
}
