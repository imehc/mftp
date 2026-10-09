import { useEffect, useRef, useState } from "react";

export function useWorkspaceLayout() {
  const workspace = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    // 容器查询同时考虑应用导航与根字号；读取同一 CSS 标志避免两套断点漂移。
    const update = () =>
      setWide(
        getComputedStyle(element).getPropertyValue("--model-wide").trim() ===
          "1",
      );
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(document.documentElement);
    update();
    return () => observer.disconnect();
  }, []);
  return { workspace, wide };
}
