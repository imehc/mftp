import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * 环境规格单元格：标签在上、值在下，用于在一屏内紧凑排布多项只读信息。
 * 与设置行的区别是这里只做对照阅读，不带图标、不带操作，因此不共用 `SettingsInfoRow`。
 */
export function EnvironmentField({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 text-sm font-medium break-words tabular-nums">
        {value}
      </dd>
    </div>
  );
}
