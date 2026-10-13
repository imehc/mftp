import { Trans } from "@lingui/react/macro";
import { ChevronRightIcon, ListChecksIcon } from "lucide-react";

/** 待处理时占用原有击球控件区域，收起弹窗后仍可查看球桌并直接返回选择。 */
export function BilliardsDecisionNotice({
  foul,
  open,
  onOpen,
}: {
  foul: boolean;
  open: boolean;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      data-rule-pending
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
      className="billiards-decision-notice bg-muted/50 hover:bg-accent focus-visible:ring-ring mx-auto flex h-full w-full max-w-6xl min-w-0 items-center justify-between gap-3 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset md:px-4"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ListChecksIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="text-sm font-medium">
          {foul ? (
            <Trans comment="台球底部常驻提示，犯规后的选择尚未完成">
              犯规待处理
            </Trans>
          ) : (
            <Trans comment="台球底部常驻提示，当前需要玩家作出规则选择">
              待处理
            </Trans>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm">
        <Trans comment="台球底部入口，重新展开尚未处理的规则选择弹窗">
          查看选项
        </Trans>
        <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0" />
      </span>
    </button>
  );
}
