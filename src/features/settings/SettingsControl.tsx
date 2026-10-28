import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "~/components/ui/field";

/** 配置行与导航行共用文字、图标和分隔尺寸；控件不嵌套进按钮。 */
export default function SettingsControl({
  icon: Icon,
  title,
  description,
  id,
  children,
  compact = false,
  error = false,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  id: string;
  children: ReactNode;
  compact?: boolean;
  error?: boolean;
}) {
  return (
    <Field
      orientation="horizontal"
      className={cn(
        "gap-3 border-b px-1 py-2 last:border-0 has-[>[data-slot=field-content]]:items-center",
        compact ? "min-h-12" : "min-h-[max(44px,4rem)]",
      )}
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <FieldContent className="min-w-16">
        <FieldLabel htmlFor={id} className="max-w-full wrap-break-word">
          {title}
        </FieldLabel>
        {description ? (
          <FieldDescription
            role={error ? "alert" : undefined}
            className="text-xs"
          >
            {description}
          </FieldDescription>
        ) : null}
      </FieldContent>
      <div
        className={
          compact ? "shrink-0" : "flex min-w-0 shrink basis-[60%] justify-end"
        }
      >
        {children}
      </div>
    </Field>
  );
}
