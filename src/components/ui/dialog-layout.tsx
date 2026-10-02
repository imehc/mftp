import * as React from "react";
import { Trans } from "@lingui/react/macro";
import { XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "~/components/ui/dialog";
import { cn } from "cn";

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
  children,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof DialogHeader> & { showCloseButton?: boolean }) {
  return (
    <DialogHeader
      className={cn(
        "border-border border-b pr-10 pb-3",
        showCloseButton && "flex-row items-center justify-between gap-2 pr-0",
        className,
      )}
      {...props}
    >
      {showCloseButton ? (
        <>
          <div className="min-w-0 flex-1">{children}</div>
          {/* 同排关闭入口随标题与缩放居中；Content 应关闭默认的绝对定位入口。 */}
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="-my-2 -mr-2 shrink-0"
            >
              <XIcon />
              <span className="sr-only">
                <Trans>关闭</Trans>
              </span>
            </Button>
          </DialogClose>
        </>
      ) : (
        children
      )}
    </DialogHeader>
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
