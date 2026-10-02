import { useRef, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import {
  useTodoTimeFields,
  type TodoTimeControlProps,
} from "./hooks/use-todo-time-fields";

export default function TodoTimeSelectDesktop(props: TodoTimeControlProps) {
  const fields = useTodoTimeFields(props);
  const { invalid } = props;
  const fieldRef = useRef<HTMLDivElement>(null);
  const [boundary, setBoundary] = useState<Element | null>(null);

  return (
    <Field
      ref={fieldRef}
      orientation="horizontal"
      data-invalid={invalid}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3"
    >
      <FieldLabel id="todo-clock-label" className="shrink-0">
        <Trans>时间</Trans>
      </FieldLabel>
      <div
        role="group"
        aria-labelledby="todo-clock-label"
        className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2"
      >
        {fields.map((part, index) => (
          <Select
            key={part.id}
            value={part.value}
            onValueChange={part.change}
            onOpenChange={(open) => {
              // Portal 不继承父弹层安全区，碰撞边界需显式沿用所属弹层。
              if (open)
                setBoundary(
                  fieldRef.current?.closest('[role="dialog"]') ?? null,
                );
            }}
          >
            {index === 1 ? <span aria-hidden="true">:</span> : null}
            <SelectTrigger
              id={part.id}
              aria-label={part.label}
              aria-invalid={invalid}
              className="w-full min-w-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="start"
              collisionBoundary={boundary}
              collisionPadding={8}
              className="ui-density-adaptive max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-0"
            >
              <SelectGroup>
                {part.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ))}
      </div>
    </Field>
  );
}
