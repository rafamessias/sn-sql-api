import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

type VirtualListOptions = {
  totalItems: number;
  rowHeight: number;
  overscan?: number;
};

type VirtualListResult<T extends HTMLElement> = {
  containerRef: RefObject<T>;
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  totalHeight: number;
};

export const useVirtualList = <T extends HTMLElement>({
  totalItems,
  rowHeight,
  overscan = 12,
}: VirtualListOptions): VirtualListResult<T> => {
  const containerRef = useRef<T>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);

    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });

    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  return useMemo(() => {
    const safeRowHeight = Math.max(rowHeight, 1);
    const totalHeight = totalItems * safeRowHeight;
    const visibleCount = Math.ceil(viewportHeight / safeRowHeight);
    const rawStart = Math.floor(scrollTop / safeRowHeight) - overscan;
    const rawEnd = rawStart + visibleCount + overscan * 2;
    const startIndex = Math.max(0, rawStart);
    const endIndex = Math.min(totalItems, Math.max(startIndex, rawEnd));
    const paddingTop = startIndex * safeRowHeight;

    return {
      containerRef,
      startIndex,
      endIndex,
      paddingTop,
      totalHeight,
    };
  }, [totalItems, rowHeight, overscan, scrollTop, viewportHeight]);
};
