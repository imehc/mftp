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
  fixed = false,
  disabled,
  description,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  fixed?: boolean;
  disabled?: boolean;
  description?: ReactNode;
}) {
  const Choice = fixed ? FixedSelect : Select;
  return (
    <SettingsControl
      id={id}
      icon={icon}
      title={title}
      description={description}
    >
      <Choice
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        {...(fixed ? { alignment: "end" as const } : {})}
      >
        <SelectTrigger id={id} aria-label={title} className="w-40 max-w-full">
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
