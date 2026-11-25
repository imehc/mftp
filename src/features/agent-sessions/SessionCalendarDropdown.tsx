import { type DropdownProps, useDayPicker } from "react-day-picker";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

function CalendarDropdown({
  options,
  value,
  disabled,
  "aria-label": label,
  onValueChange,
}: DropdownProps & { onValueChange: (value: string) => void }) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={onValueChange}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options?.map((option) => (
            <SelectItem
              key={option.value}
              value={String(option.value)}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function SessionCalendarMonthsDropdown(props: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  return (
    <CalendarDropdown
      {...props}
      onValueChange={(value) => {
        const current = months[0]?.date ?? new Date();
        goToMonth(new Date(current.getFullYear(), Number(value), 1));
      }}
    />
  );
}

export function SessionCalendarYearsDropdown(props: DropdownProps) {
  const { months, goToMonth } = useDayPicker();
  return (
    <CalendarDropdown
      {...props}
      onValueChange={(value) => {
        const current = months[0]?.date ?? new Date();
        goToMonth(new Date(Number(value), current.getMonth(), 1));
      }}
    />
  );
}
