import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "~/components/ui/button";

/** 设置行内嵌菜单的触发器，与固定下拉保持同一紧凑宽度；事件与 ref 必须透传给按钮。 */
export default function SettingMenuTrigger({
  label,
  ...props
}: ComponentProps<typeof Button> & { label: ReactNode }) {
  return (
    <Button
      {...props}
      type="button"
      variant="outline"
      // 设置值允许换行，表面高度由完整标签决定。
      density="default"
      className="h-auto min-h-8 w-40 max-w-full justify-between py-1 pr-2 pl-2.5 text-left text-sm font-normal whitespace-normal"
    >
      <span className="min-w-0 wrap-break-word">{label}</span>
      <ChevronDown aria-hidden className="text-muted-foreground size-4" />
    </Button>
  );
}
