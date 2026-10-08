import { cn } from "cn";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

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
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {description}
          </span>
        ) : null}
      </span>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

export function SettingsGroup({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card min-w-0 rounded-xl border p-3">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}
