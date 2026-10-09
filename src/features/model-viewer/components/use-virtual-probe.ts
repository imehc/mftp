import { type RefObject, useEffect } from "react";

/**
 * 探针尺寸真实变化时让虚拟列表重新测量。
 *
 * ResizeObserver 在 observe() 后立即回调一次，此时并没有尺寸变化；直接
 * measure() 会清空元素已经测得的行高，退回估算值并留下多余留白。
 */
export function useVirtualProbe(
  probe: RefObject<HTMLElement | null>,
  virtualizer: { measure: () => void },
) {
  useEffect(() => {
    const element = probe.current;
    if (!element) return;
    let last = element.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().height;
      if (Math.abs(next - last) < 0.5) return;
      last = next;
      virtualizer.measure();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [probe, virtualizer]);
}
