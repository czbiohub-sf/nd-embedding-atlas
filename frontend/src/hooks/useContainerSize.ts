import { type RefObject, useEffect, useState } from "react";

interface Size {
  width: number;
  height: number;
}

export function useContainerSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
