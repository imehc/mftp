import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLingui } from "@lingui/react/macro";
import type { ModelViewerRuntime } from "../runtime/viewer";
import type { ViewAxis } from "../runtime/orientation";

export function ViewGizmo({ runtime }: { runtime: ModelViewerRuntime }) {
  const { t } = useLingui();
  const host = useRef<HTMLButtonElement>(null);
  const mode = useSyncExternalStore(
    runtime.tools.subscribe,
    () => runtime.tools.snapshot().mode,
  );
  useEffect(() => {
    runtime.attachGizmo(host.current);
    return () => runtime.attachGizmo(null);
  }, [runtime]);
  const label = t({
    message:
      "XYZ 方向：点击坐标轴切换视角，双击适配模型。也可按 X、Y、Z，按住 Shift 查看反方向。",
    comment: "模型画布内坐标轴组件的操作提示与无障碍名称。",
  });
  return (
    <button
      ref={host}
      type="button"
      hidden={mode !== "orbit"}
      aria-label={label}
      title={label}
      className="focus-visible:ring-ring absolute top-2 right-2 size-28 cursor-pointer rounded-full bg-transparent focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-32"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (event.detail === 0) runtime.fit();
        else runtime.pickAxis(event.clientX, event.clientY);
      }}
      onDoubleClick={() => runtime.fit()}
      onKeyDown={(event) => {
        const key = event.key.toUpperCase();
        if (!["X", "Y", "Z"].includes(key)) return;
        event.preventDefault();
        runtime.viewAxis(`${event.shiftKey ? "neg" : "pos"}${key}` as ViewAxis);
      }}
    />
  );
}
