import { useLingui } from "@lingui/react/macro";

import { Spinner } from "~/components/ui/spinner";

/** 思考状态复用加载动画；减少动态效果时保留静态的有名状态图标。 */
export function GameThinkingIndicator() {
  const { t } = useLingui();
  const label = t({
    message: "电脑思考中",
    comment: "加载图标的可访问名称及悬停说明，等待本地电脑完成走法。",
  });
  return (
    <span className="inline-flex shrink-0 align-middle" title={label}>
      <Spinner className="motion-reduce:animate-none" aria-label={label} />
    </span>
  );
}
