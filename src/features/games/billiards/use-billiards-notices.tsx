import { useState } from "react";

import type { LightNoticeMessage } from "~/components/LightNotice";

import { billiardsNotices } from "./notices";
import type { BilliardsMode, BilliardsState } from "./types";

interface NoticePlanInput {
  /** 上一次的活跃 id 顺序（按首次出现排列）。 */
  order: string[];
  /** 因超出显示上限被挤掉、在状态消失前不再重新出现的 id。 */
  suppressed: string[];
}

export interface NoticePlan {
  order: string[];
  /** 本次应当展示的 id（按出现顺序）。 */
  visible: string[];
  suppressed: string[];
}

/**
 * 计算本次要展示的提示 id：保持首次出现顺序，只展示最近出现的
 * `limit` 条；被挤掉且状态仍在的 id 记入 `suppressed`，避免其再次
 * 冒出来，直到对应状态消失才解禁。
 */
export function planNotices(
  previous: NoticePlanInput,
  activeIds: string[],
  limit: number,
): NoticePlan {
  const order = [
    ...previous.order.filter((id) => activeIds.includes(id)),
    ...activeIds.filter((id) => !previous.order.includes(id)),
  ];
  const suppressed = previous.suppressed.filter((id) => activeIds.includes(id));
  const visible = order.slice(-limit).filter((id) => !suppressed.includes(id));
  const suppressedSet = new Set([
    ...suppressed,
    ...order.filter((id) => !visible.includes(id)),
  ]);
  return { order, visible, suppressed: [...suppressedSet] };
}

/** 台球规则提示沿用去重和展示上限，交给共用轻提示处理计时与主题。 */
export function useBilliardsNotices(
  state: BilliardsState,
  mode: BilliardsMode,
  ballInHand: boolean,
): LightNoticeMessage[] {
  const notices = billiardsNotices(state, mode, ballInHand);
  const activeIds = notices.map((notice) => notice.id);
  const signature = JSON.stringify(activeIds);
  const [tracked, setTracked] = useState(() => ({
    signature,
    plan: planNotices({ order: [], suppressed: [] }, activeIds, 2),
  }));
  if (tracked.signature !== signature)
    setTracked({ signature, plan: planNotices(tracked.plan, activeIds, 2) });
  return notices
    .filter((notice) => tracked.plan.visible.includes(notice.id))
    .map((notice) => ({
      id: notice.id,
      message: (
        <>
          {notice.title}
          {notice.description ? (
            <>
              {" · "}
              {notice.description}
            </>
          ) : null}
        </>
      ),
    }));
}
