import { useLayoutEffect, useRef, useState } from "react";

export function useWorkspaceLayout() {
  const workspace = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const element = workspace.current;
    if (!element) return;
    // 测量外层可用宽度，不从受侧栏内容影响的网格读取布局标志。
    // 首次绘制前同步判断；CSS 通过 data-wide 使用同一结果。
    const update = () => setWide(element.getBoundingClientRect().width >= 560);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  return { workspace, wide };
}
