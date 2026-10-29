import { cn } from "cn";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Badge } from "~/components/ui/badge";

/** 设置入口的图标、两行文案、分隔与触控尺寸统一在此处。 */
export function SettingsEntry({
  icon: Icon,
  title,
  description,
  className,
  ...props
}: Omit<ComponentProps<"button">, "title"> & {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "hover:bg-accent focus-visible:ring-ring flex min-h-[max(44px,4rem)] w-full items-center gap-3 border-b px-1 py-2 text-left last:border-0 focus-visible:ring-2 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description ? (
          <span className="app-description mt-0.5 block">{description}</span>
        ) : null}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

/** 只读信息行；与导航行、配置行共享图标槽、文字层级和最小行高。 */
export function SettingsInfoRow({
  icon: Icon,
  title,
  value,
}: {
  icon: LucideIcon;
  title: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex min-h-[max(44px,4rem)] items-center gap-3 border-b px-1 py-2 last:border-0">
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-sm">{title}</span>
      <Badge variant="secondary" className="shrink-0">
        {value}
      </Badge>
    </div>
  );
}

export function SettingsGroup({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "bg-card @container/settings min-w-0 rounded-xl border p-3",
        className,
      )}
    >
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
