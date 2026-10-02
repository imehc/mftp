import type { Dispatch, SetStateAction } from "react";
import { useLingui } from "@lingui/react/macro";

export interface TodoTimeControlProps {
  value: string;
  invalid: boolean;
  onChange: Dispatch<SetStateAction<string>>;
}

const HOURS = Array.from({ length: 24 }, (_, hour) =>
  String(hour).padStart(2, "0"),
);
const MINUTES = Array.from({ length: 60 }, (_, minute) =>
  String(minute).padStart(2, "0"),
);

export function useTodoTimeFields({ value, onChange }: TodoTimeControlProps) {
  const { t } = useLingui();
  const [hour, minute] = value.split(":");
  return [
    {
      id: "todo-schedule-hour",
      label: t({ message: "小时", comment: "计划时刻的小时选择，24 小时制" }),
      value: hour,
      options: HOURS,
      // 两列可能同时结束惯性滚动，函数更新避免覆盖另一列刚提交的值。
      change: (next: string) =>
        onChange((previous) => `${next}:${previous.split(":")[1]}`),
    },
    {
      id: "todo-schedule-minute",
      label: t({ message: "分钟", comment: "计划时刻的分钟选择，00 至 59" }),
      value: minute,
      options: MINUTES,
      change: (next: string) =>
        onChange((previous) => `${previous.split(":")[0]}:${next}`),
    },
  ];
}
