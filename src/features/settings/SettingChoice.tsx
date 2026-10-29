import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import FixedSelect from "~/components/FixedSelect";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

import SettingsControl from "./SettingsControl";

export default function SettingChoice({
  id,
  icon,
  title,
  value,
  onChange,
  options,
  segmented = false,
  disabled,
  description,
  error = false,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  segmented?: boolean;
  disabled?: boolean;
  description?: ReactNode;
  error?: boolean;
}) {
  const Choice = segmented ? FixedSelect : Select;
  return (
    <SettingsControl
      id={id}
      icon={icon}
      title={title}
      description={description}
      error={error}
    >
      <Choice
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        {...(segmented ? { alignment: "end" as const } : {})}
      >
        <SelectTrigger
          wrapValue
          id={id}
          aria-label={title}
          aria-invalid={error || undefined}
          aria-describedby={description ? `${id}-description` : undefined}
          className="w-40 max-w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Choice>
    </SettingsControl>
  );
}
