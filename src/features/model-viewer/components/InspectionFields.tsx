import { type ReactNode, useId } from "react";

import FixedSelect from "~/components/FixedSelect";
import { Field, FieldLabel } from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";

export function InspectionChoice({
  label,
  value,
  options,
  onChange,
  segmented = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  segmented?: boolean;
}) {
  const id = useId();
  const Choice = segmented ? FixedSelect : Select;
  return (
    <Field orientation={segmented ? "choice" : "vertical"}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Choice value={value} onValueChange={onChange}>
        <SelectTrigger id={id} density="adaptive" className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="ui-density-adaptive">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Choice>
    </Field>
  );
}

export function InspectionRange({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id} className="min-w-0 justify-between">
        <span className="min-w-0 wrap-break-word">{label}</span>
        <span className="tabular-nums">{value.toFixed(2)}</span>
      </FieldLabel>
      <Slider
        id={id}
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(values) => onChange(values[0])}
      />
    </Field>
  );
}

export function InspectionToggle({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <FieldLabel
        htmlFor={id}
        data-slot="touch-label"
        className="min-h-8 min-w-0 flex-1"
      >
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}
