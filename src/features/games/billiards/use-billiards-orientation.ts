import { useEffect, useRef } from "react";
import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";

/** 只释放本页申请的全屏与方向锁；异步申请结束时再次核对对局归属。 */
export function useBilliardsOrientation(active: boolean, landscape: boolean) {
  const { t } = useLingui();
  const lease = useRef({
    active,
    generation: 0,
    pending: false,
    fullscreen: false,
    locked: false,
  });
  const release = () => {
    const state = lease.current;
    if (state.locked) screen.orientation?.unlock?.();
    state.locked = false;
    if (
      state.fullscreen &&
      document.fullscreenElement === document.documentElement
    )
      void document.exitFullscreen().catch(() => undefined);
    state.fullscreen = false;
  };
  useEffect(() => {
    const state = lease.current;
    state.active = active;
    return () => {
      state.active = false;
      state.generation++;
      release();
    };
  }, [active]);
  return async () => {
    const state = lease.current;
    if (!state.active || state.pending) return;
    if (landscape) {
      release();
      toast.info(t`请将设备转为竖屏，当前对局会保留`);
      return;
    }
    state.pending = true;
    const generation = state.generation;
    const valid = () => state.active && state.generation === generation;
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (value: string) => Promise<void> })
      | undefined;
    try {
      // 全屏根节点包含 Portal，菜单及确认框不会被浏览器全屏层遮住。
      if (
        !document.fullscreenElement &&
        document.documentElement.requestFullscreen
      ) {
        await document.documentElement
          .requestFullscreen()
          .then(() => {
            state.fullscreen = true;
          })
          .catch(() => undefined);
      }
      if (!valid()) return;
      if (orientation?.lock) {
        await orientation.lock("landscape");
        state.locked = true;
      } else {
        toast.info(t`请横向旋转设备，当前对局会保留`);
      }
    } catch {
      if (valid()) toast.info(t`请横向旋转设备，当前对局会保留`);
    } finally {
      state.pending = false;
      if (!valid()) release();
    }
  };
}
