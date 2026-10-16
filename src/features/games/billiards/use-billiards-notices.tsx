import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  BILLIARDS_NOTICE_DURATION,
  BILLIARDS_TOASTER_ID,
  BILLIARDS_VISIBLE_NOTICES,
} from "./BilliardsToaster";
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

/**
 * 将台面状态同步为顶部中间消息：状态成立时展示，状态消失时关闭。
 *
 * 同时最多展示 `BILLIARDS_VISIBLE_NOTICES` 条，超出时最早出现的一条立即
 * 消失；每条展示 `BILLIARDS_NOTICE_DURATION` 后自动关闭。使用内容派生的
 * 稳定 `id` 去重，已在展示的 id 不重复创建（避免重置计时、重播动画），
 * 卸载时统一清理，避免遗留到下一次对局。
 */
export function useBilliardsNotices(
  state: BilliardsState,
  mode: BilliardsMode,
  ballInHand: boolean,
) {
  const order = useRef<string[]>([]);
  const suppressed = useRef<string[]>([]);
  const shown = useRef<string[]>([]);

  useEffect(() => {
    const notices = billiardsNotices(state, mode, ballInHand);
    const activeIds = notices.map((notice) => notice.id);
    const plan = planNotices(
      { order: order.current, suppressed: suppressed.current },
      activeIds,
      BILLIARDS_VISIBLE_NOTICES,
    );
    order.current = plan.order;
    suppressed.current = plan.suppressed;

    const visibleSet = new Set(plan.visible);
    for (const notice of notices) {
      if (!visibleSet.has(notice.id)) continue;
      // id 由内容派生，内容不变时重复创建只会重置计时，故跳过。
      if (shown.current.includes(notice.id)) continue;
      const options = {
        id: notice.id,
        toasterId: BILLIARDS_TOASTER_ID,
        duration: BILLIARDS_NOTICE_DURATION,
        description: notice.description,
      };
      if (notice.tone === "warning") toast.warning(notice.title, options);
      else toast(notice.title, options);
    }
    for (const id of shown.current) {
      if (!visibleSet.has(id)) toast.dismiss(id);
    }
    shown.current = plan.visible;
  }, [state, mode, ballInHand]);

  useEffect(
    () => () => {
      for (const id of shown.current) toast.dismiss(id);
      order.current = [];
      suppressed.current = [];
      shown.current = [];
    },
    [],
  );
}
