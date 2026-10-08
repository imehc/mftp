import { Trans } from "@lingui/react/macro";

import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import type { TodoScheduleOverlayProps } from "./todo-schedule-overlay";

/** 移动弹层沿用有效视口和固定操作区，键盘不会盖住确认按钮。 */
export default function TodoScheduleDialogMobile({
  open,
  onOpenChange,
  trigger,
  calendar,
  controls,
  actions,
}: TodoScheduleOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogLayoutContent
        className="ui-density-adaptive max-w-sm"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>计划时间</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-3">
          {/* 七列按正文实际宽度分配，系统字号增大时不能沿用视口推算的最小列宽。 */}
          <div className="@container mx-auto w-full max-w-[21rem]">
            {calendar}
          </div>
          {controls}
        </DialogLayoutBody>
        <DialogLayoutFooter className="flex-col gap-3 md:flex-col">
          {actions}
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
