import { useEffect } from "react";

/** 观察实际 rem 尺寸，覆盖应用比例、系统字号与运行时样式变化。 */
export function observeRootFontSize(changed: (pixels: number) => void) {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;width:0;height:1rem;overflow:hidden;top:0;left:0;";
  document.body.appendChild(probe);
  let last = 0;

  const measure = () => {
    const pixels = probe.getBoundingClientRect().height;
    if (pixels > 0 && pixels !== last) {
      last = pixels;
      changed(pixels);
    }
  };

  const observer = new ResizeObserver(measure);
  observer.observe(probe);
  measure();
  return () => {
    observer.disconnect();
    probe.remove();
  };
}

/** 清除离屏行的旧尺寸缓存；可见行仍由虚拟列表自身重新测量。 */
export function useVirtualizerFontSize(virtualizer: { measure: () => void }) {
  useEffect(
    () => observeRootFontSize(() => virtualizer.measure()),
    [virtualizer],
  );
}
