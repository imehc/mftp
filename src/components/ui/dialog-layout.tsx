import * as React from "react";
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

/**
 * 通用对话框框架：标题栏和操作栏保持不动，仅主体区域滚动。
 * 调用方结合已有的 Dialog root/title API 组合使用。
 */
function DialogLayoutContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        "grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}

function DialogLayoutHeader({
  className,
  ...props
}: React.ComponentProps<typeof DialogHeader>) {
  return (
    <DialogHeader
      className={cn("border-border border-b pb-3", className)}
      {...props}
    />
  );
}

function DialogLayoutBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-layout-body"
      className={cn("min-h-0 overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

function DialogLayoutFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  return <DialogFooter className={className} {...props} />;
}

export {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
};
