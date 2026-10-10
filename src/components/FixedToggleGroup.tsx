import {
  Children,
  type ComponentProps,
  isValidElement,
  type ReactNode,
} from "react";

import FixedSelect from "~/components/FixedSelect";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ToggleGroup } from "~/components/ui/toggle-group";

/** 固定单选组沿用同一空间测量和下拉回退，调用方继续拥有选项及业务行为。 */
export default function FixedToggleGroup({
  children,
  value,
  onValueChange,
  disabled,
  ...props
}: Extract<ComponentProps<typeof ToggleGroup>, { type: "single" }>) {
  return (
    <FixedSelect
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger
        id={props.id}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Children.map(children, (child) => {
            if (
              !isValidElement<{
                value: string;
                disabled?: boolean;
                children: ReactNode;
              }>(child)
            )
              return null;
            return (
              <SelectItem
                value={child.props.value}
                disabled={child.props.disabled}
              >
                {child.props.children}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </FixedSelect>
  );
}
