import type { PlaybackTick } from "../playback";

/** 空闲桌面不占用渲染帧；回放 ticker 与 GSAP 更新都通过同一入口请求绘制。 */
export function createRenderClock(
  render: () => void,
  onError: (error: unknown) => void,
) {
  const listeners = new Set<(tick: PlaybackTick) => void>();
  let frame = 0;
  let previous = 0;
  let disposed = false;
  const tick = { deltaMS: 0 };

  const draw = (time: number) => {
    frame = 0;
    if (disposed) return;
    tick.deltaMS = previous ? Math.min(time - previous, 50) : 0;
    previous = time;
    try {
      for (const listener of listeners) listener(tick);
      render();
    } catch (error) {
      onError(error);
      return;
    }
    if (listeners.size) invalidate();
    else previous = 0;
  };

  const invalidate = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  };

  return {
    invalidate,
    ticker: {
      add(callback: (tick: PlaybackTick) => void) {
        listeners.add(callback);
        invalidate();
      },
      remove(callback: (tick: PlaybackTick) => void) {
        listeners.delete(callback);
      },
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      listeners.clear();
    },
  };
}
