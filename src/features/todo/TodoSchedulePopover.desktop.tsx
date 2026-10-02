import { useLingui } from "@lingui/react/macro";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { TodoScheduleOverlayProps } from "./todo-schedule-overlay";

export default function TodoSchedulePopoverDesktop({
  open,
  onOpenChange,
  trigger,
  calendar,
  controls,
  actions,
}: TodoScheduleOverlayProps) {
  const { t } = useLingui();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={t`计划时间`}
        collisionPadding={12}
        className="grid max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-1.5rem)] grid-cols-[auto_minmax(13rem,1fr)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0"
      >
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {calendar}
        </div>
        <div className="flex min-h-0 flex-col gap-3 border-l p-3">
          <div className="min-h-0 overflow-y-auto">{controls}</div>
          <div className="mt-auto shrink-0">{actions}</div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
