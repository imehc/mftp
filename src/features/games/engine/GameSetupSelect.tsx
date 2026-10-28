import { cn } from "cn";
import { type ReactNode, useId } from "react";

import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { TOUCH_TARGET_CLASS } from "~/lib/touch";

/** 开局工具栏的规则参数紧邻标签排列，不继承整行配置表单的两端对齐。 */
export function GameSetupSelect({
  label,
  value,
  onChange,
  options,
  density = "default",
  wrapValue = true,
}: {
  label: ReactNode;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: ReactNode }[];
  density?: "default" | "adaptive";
  wrapValue?: boolean;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal" className="w-auto max-w-full">
      <FieldLabel htmlFor={id} className="shrink-0">
        {label}
      </FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id={id}
          density={density}
          wrapValue={wrapValue}
          className={cn(
            "max-w-48 min-w-0",
            density === "adaptive" && TOUCH_TARGET_CLASS,
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className={cn(
            "motion-safe:data-closed:animate-none",
            density === "adaptive" && "ui-density-adaptive",
          )}
        >
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
