import { type RefObject, useLayoutEffect, useRef } from "react";

import {
  poetryReadingSession,
  type ReadingPositionKey,
  readingSnapshot,
} from "../reading-session";

/** 内容就绪后恢复；切换面板前保存旧坐标，避免隐藏 DOM 后的滚动收敛污染快照。 */
export function usePoetryReadingPosition({
  uid,
  positionKey,
  ready,
  viewport,
}: {
  uid?: string;
  positionKey: ReadingPositionKey;
  ready: boolean;
  viewport: RefObject<HTMLDivElement | null>;
}) {
  const capture = useRef<(() => void) | null>(null);
  const previous = useRef<{
    uid: string;
    key: ReadingPositionKey;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!uid || !element) return;
    const last = previous.current;
    // 桌面新辅助面板没有坐标时保持标签所在位置，不突然跳回长原文顶部。
    const fallback =
      last?.uid === uid &&
      last.key.startsWith("desktop-") &&
      positionKey.startsWith("desktop-")
        ? last.top
        : 0;
    const desired = readingSnapshot(uid)?.positions[positionKey] ?? fallback;
    let top = desired;
    let restored = false;
    let disposed = false;
    let frame = 0;
    let saveFrame = 0;

    function save() {
      if (!restored) return;
      poetryReadingSession
        .getState()
        .update(uid!, { positions: { [positionKey]: top } });
      previous.current = { uid: uid!, key: positionKey, top };
    }

    function captureCurrent() {
      if (restored) top = element!.scrollTop;
      save();
    }

    function onScroll() {
      if (!restored) return;
      top = element!.scrollTop;
      cancelAnimationFrame(saveFrame);
      saveFrame = requestAnimationFrame(save);
    }

    function interact() {
      // 用户先操作就以用户位置为准，异步字体或译文到达后不再强行拉回。
      if (!restored) {
        restored = true;
        top = element!.scrollTop;
      }
    }

    capture.current = captureCurrent;
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("wheel", interact, { passive: true });
    element.addEventListener("touchstart", interact, { passive: true });
    element.addEventListener("keydown", interact);
    if (ready)
      void Promise.resolve(document.fonts?.ready).then(() => {
        if (disposed || restored) return;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            if (disposed || restored) return;
            element.scrollTop = Math.max(
              0,
              Math.min(desired, element.scrollHeight - element.clientHeight),
            );
            top = element.scrollTop;
            restored = true;
          });
        });
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(saveFrame);
      // 使用最后观察到的位置；cleanup 时新面板可能已经改变 scrollHeight。
      save();
      capture.current = null;
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("wheel", interact);
      element.removeEventListener("touchstart", interact);
      element.removeEventListener("keydown", interact);
    };
  }, [uid, positionKey, ready, viewport]);
  return () => capture.current?.();
}
