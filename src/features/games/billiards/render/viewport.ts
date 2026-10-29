export interface BilliardsViewport {
  width: number;
  height: number;
  table: { x: number; y: number; width: number; height: number };
  portrait: boolean;
}

/** 画布覆盖整个 WebView；输入与浮层继续使用球桌自己的矩形。 */
export function observeBilliardsViewport(
  input: HTMLElement,
  onChange: (viewport: BilliardsViewport) => void,
) {
  const orientation = window.matchMedia("(orientation: portrait)");
  let previous = "";
  let disposed = false;

  function measure() {
    if (disposed) return;
    const table = input.getBoundingClientRect();
    const viewport: BilliardsViewport = {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      table: {
        x: table.left,
        y: table.top,
        width: Math.max(1, table.width),
        height: Math.max(1, table.height),
      },
      portrait: orientation.matches,
    };
    const key = JSON.stringify(viewport);
    if (key === previous) return;
    previous = key;
    onChange(viewport);
  }

  const observer = new ResizeObserver(measure);

  function observeLayout() {
    observer.disconnect();
    mutations.disconnect();
    // 观察到文档根及沿途兄弟，包含应用侧栏；纯位移也需要重新对齐绘制相机。
    let element: HTMLElement | null = input;
    while (element) {
      observer.observe(element);
      mutations.observe(element, {
        childList: true,
        attributes: true,
        attributeFilter: ["class", "style", "data-landscape"],
      });
      for (const sibling of element.parentElement?.children ?? []) {
        if (sibling.tagName !== "CANVAS") observer.observe(sibling);
      }
      element = element.parentElement;
    }
  }

  const mutations = new MutationObserver(() => {
    if (disposed) return;
    observeLayout();
    measure();
  });
  observeLayout();
  orientation.addEventListener("change", measure);
  window.addEventListener("resize", measure);
  window.addEventListener("scroll", measure, true);
  window.visualViewport?.addEventListener("resize", measure);

  return {
    measure,
    dispose() {
      disposed = true;
      observer.disconnect();
      mutations.disconnect();
      orientation.removeEventListener("change", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
    },
  };
}
