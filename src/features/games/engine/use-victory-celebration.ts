import { useEffect, useRef } from "react";

import { launchVictoryConfetti } from "./VictoryConfetti";

/**
 * 单机玩法没有对局结算栏，用上升沿触发一次共享彩带动画。
 * 首次渲染取当前值作为基准，避免重复渲染或超时刷新反复播放。
 */
export function useVictoryCelebration(completed: boolean): void {
  const previous = useRef(completed);
  useEffect(() => {
    if (completed && !previous.current) launchVictoryConfetti();
    previous.current = completed;
  }, [completed]);
}
