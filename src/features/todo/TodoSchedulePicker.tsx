import { Trans, useLingui } from "@lingui/react/macro";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { dateLocale } from "~/lib/date-locale";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import {
  localDateKey,
  localTimeKey,
  plannedTimestamp,
  todoDateFromKey,
} from "./todo-utils";
import TodoScheduleDialogMobile from "./TodoScheduleDialog.mobile";
import TodoSchedulePopoverDesktop from "./TodoSchedulePopover.desktop";
import TodoTimeSelectDesktop from "./TodoTimeSelect.desktop";
import TodoTimeWheelMobile from "./TodoTimeWheel.mobile";

/** 只持有弹层草稿；确认后才写回共用表单，关闭弹层不改变原计划。 */
export default function TodoSchedulePicker({
  date,
  time,
  error,
  onChange,
}: {
  date: string;
  time: string;
  error: boolean;
  onChange: (date: string, time: string) => void;
}) {
  const { i18n, t } = useLingui();
  const desktop = useDesktopLayout();
  const Overlay = desktop
    ? TodoSchedulePopoverDesktop
    : TodoScheduleDialogMobile;
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(() => localDateKey(new Date()));
  const [draftTime, setDraftTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const TimeControl = desktop ? TodoTimeSelectDesktop : TodoTimeWheelMobile;
  const dateOnlyLabel = t({
    message: "不指定时间",
    comment: "待办仅指定日期，不指定具体时分；不是全天提醒",
  });
  const valid = allDay || plannedTimestamp(draftDate, draftTime) !== null;
  const label = date
    ? `${format(todoDateFromKey(date), "PPP", { locale: dateLocale(i18n.locale) })} · ${time || dateOnlyLabel}`
    : t`选择计划时间`;

  return (
    <Overlay
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const now = new Date();
          setDraftDate(date || localDateKey(now));
          setDraftTime(time || localTimeKey(now));
          setAllDay(Boolean(date) && !time);
        }
        setOpen(next);
      }}
      trigger={
        <Button
          id="todo-schedule"
          type="button"
          variant="outline"
          className="w-full min-w-0 justify-start font-normal"
          aria-invalid={error}
          aria-describedby={error ? "todo-time-error" : undefined}
        >
          <CalendarIcon data-icon="inline-start" />
          <span className="truncate">{label}</span>
        </Button>
      }
      calendar={
        <Calendar
          mode="single"
          required
          locale={dateLocale(i18n.locale)}
          selected={todoDateFromKey(draftDate)}
          defaultMonth={todoDateFromKey(draftDate)}
          onSelect={(selected) => setDraftDate(localDateKey(selected))}
          className={
            desktop
              ? "[--cell-size:2rem]"
              : "w-full [--cell-size:calc((100cqw-1rem)/7)]"
          }
          labels={{
            labelPrevious: () => t`上个月`,
            labelNext: () => t`下个月`,
            labelNav: () => t`选择月份`,
            labelDayButton: (day, modifiers) =>
              [
                format(day, "PPPP", { locale: dateLocale(i18n.locale) }),
                modifiers.today ? t`今天` : null,
                modifiers.selected ? t`已选择` : null,
              ]
                .filter(Boolean)
                .join(", "),
          }}
        />
      }
      controls={
        <div className="ui-density-adaptive flex w-full flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="todo-schedule-all-day" className="min-h-11 flex-1">
              {dateOnlyLabel}
            </Label>
            <Switch
              id="todo-schedule-all-day"
              checked={allDay}
              onCheckedChange={setAllDay}
            />
          </div>
          {!allDay ? (
            <TimeControl
              value={draftTime}
              invalid={!valid}
              onChange={setDraftTime}
            />
          ) : null}
        </div>
      }
      actions={
        <div className="grid w-full grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onChange("", "");
              setOpen(false);
            }}
          >
            <Trans>清除计划</Trans>
          </Button>
          <Button
            type="button"
            disabled={!valid}
            onClick={() => {
              onChange(draftDate, allDay ? "" : draftTime);
              setOpen(false);
            }}
          >
            <Trans>确定</Trans>
          </Button>
        </div>
      }
    />
  );
}
