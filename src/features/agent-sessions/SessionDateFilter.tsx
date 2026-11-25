import { Trans, useLingui } from "@lingui/react/macro";
import { format, parseISO } from "date-fns";

import { Calendar } from "~/components/ui/calendar";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { dateLocale } from "~/lib/date-locale";

import {
  SessionCalendarMonthsDropdown,
  SessionCalendarYearsDropdown,
} from "./SessionCalendarDropdown";
import type { useAgentSessions } from "./use-agent-sessions";

export function SessionDateFilter({
  controller: c,
}: {
  controller: ReturnType<typeof useAgentSessions>;
}) {
  const { i18n, t } = useLingui();
  if (c.range === "month") {
    const [year, month] = c.month.split("-");
    const currentYear = new Date().getFullYear();
    const years = [
      ...new Set([
        Number(year),
        ...Array.from({ length: 101 }, (_, index) => currentYear - index),
      ]),
    ].sort((a, b) => b - a);
    const monthName = new Intl.DateTimeFormat(i18n.locale, { month: "long" });
    return (
      <Field>
        <FieldLabel>
          <Trans>月份</Trans>
        </FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={year}
            onValueChange={(value) => c.setMonth(`${value}-${month}`)}
          >
            <SelectTrigger className="w-full" aria-label={t`年份`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {years.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={month}
            onValueChange={(value) => c.setMonth(`${year}-${value}`)}
          >
            <SelectTrigger className="w-full" aria-label={t`月份`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Array.from({ length: 12 }, (_, index) => (
                  <SelectItem
                    key={index}
                    value={String(index + 1).padStart(2, "0")}
                  >
                    {monthName.format(new Date(2020, index, 1))}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </Field>
    );
  }
  if (c.range !== "custom") return null;
  return (
    <Calendar
      mode="range"
      locale={dateLocale(i18n.locale)}
      captionLayout="dropdown"
      components={{
        MonthsDropdown: SessionCalendarMonthsDropdown,
        YearsDropdown: SessionCalendarYearsDropdown,
      }}
      selected={
        c.from
          ? { from: parseISO(c.from), to: c.to ? parseISO(c.to) : undefined }
          : undefined
      }
      defaultMonth={c.from ? parseISO(c.from) : undefined}
      onSelect={(range) => {
        c.setFrom(range?.from ? format(range.from, "yyyy-MM-dd") : "");
        c.setTo(range?.to ? format(range.to, "yyyy-MM-dd") : "");
      }}
      className="mx-auto [--cell-size:2rem]"
      labels={{
        labelPrevious: () => t`上个月`,
        labelNext: () => t`下个月`,
        labelNav: () => t`选择月份`,
        labelMonthDropdown: () => t`月份`,
        labelYearDropdown: () => t`年份`,
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
  );
}
