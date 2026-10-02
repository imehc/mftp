import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Trans } from "@lingui/react/macro";

import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "motion-safe:data-open:animate-in data-open:fade-in-0 motion-safe:data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/10 data-closed:duration-150 data-closed:ease-in data-open:duration-200 data-open:ease-out supports-backdrop-filter:backdrop-blur-xs motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  placement = "center",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  placement?: "center" | "responsive-sheet" | "responsive-page";
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/*
        Portal 挂在 body 下，拿不到 .app-shell 的安全区 padding，必须自己
        处理有效视口：外层只负责居中与安全区留白（pointer-events-none 让
        空白处的点击继续落到遮罩上关闭弹窗），内容自身滚动。
      */}
      <div
        className={cn(
          "app-viewport pointer-events-none fixed inset-0 z-50 grid place-items-center p-4 pt-[calc(1rem+var(--safe-top,0px))] pr-[calc(1rem+var(--safe-right,0px))] pb-[calc(1rem+var(--safe-bottom,0px))] pl-[calc(1rem+var(--safe-left,0px))]",
          placement === "responsive-sheet" &&
            "max-md:items-end max-md:px-0 max-md:pb-0",
          placement === "responsive-page" && "max-md:pl-[var(--safe-left,0px)] max-md:pr-[var(--safe-right,0px)] max-md:pt-[var(--safe-top,0px)] max-md:pb-[var(--safe-bottom,0px)]",
        )}
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 motion-safe:data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-open:slide-in-from-bottom-2 motion-safe:data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:slide-out-to-bottom-2 pointer-events-auto relative grid max-h-full w-full gap-4 overflow-y-auto overscroll-contain rounded-xl p-4 text-sm ring-1 outline-none data-closed:duration-150 data-closed:ease-in data-open:duration-250 data-open:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none md:max-w-sm",
            placement === "responsive-sheet" &&
              "max-md:rounded-b-none max-md:pb-[calc(1rem+var(--safe-bottom,0px))]",
            placement === "responsive-page" && "max-md:h-full max-md:rounded-none",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              >
                <XIcon />
                <span className="sr-only">
                  <Trans>关闭</Trans>
                </span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-muted/50 -mx-4 -mb-4 flex flex-row gap-2 rounded-b-xl border-t p-4 md:justify-end max-md:[&>button]:min-w-0 max-md:[&>button]:flex-1",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">
            <Trans>关闭</Trans>
          </Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
