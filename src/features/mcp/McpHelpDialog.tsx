import { Trans } from "@lingui/react/macro";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

export default function McpHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogLayoutContent placement="responsive-page" className="md:max-w-lg">
        <DialogLayoutHeader>
          <DialogTitle>
            <Trans>MCP 服务帮助</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>供可信的本机客户端调用应用模块。</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="space-y-4 text-sm">
          <section className="space-y-1">
            <h3 className="font-medium">
              <Trans>连接服务</Trans>
            </h3>
            <p className="text-muted-foreground">
              <Trans>
                添加客户端授权并保存一次性凭据，再启动服务。将连接配置中的占位符替换为凭据。客户端需支持
                Streamable HTTP 和 Bearer 认证。
              </Trans>
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">
              <Trans>访问与权限</Trans>
            </h3>
            <p className="text-muted-foreground">
              <Trans>
                服务只监听本机回环地址，云端模型不能直接访问。重启应用后需手动启动。客户端权限统一适用于全部模块，删除权限需单独开启。
              </Trans>
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">
              <Trans>授权管理</Trans>
            </h3>
            <p className="text-muted-foreground">
              <Trans>
                每个客户端分别勾选读取、写入和删除权限，统一适用于全部模块，包括后续新增模块。凭据只在生成时显示一次，遗失后需重新生成。撤销或重新生成会使旧凭据失效。
              </Trans>
            </p>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">
              <Trans>服务生命周期</Trans>
            </h3>
            <p className="text-muted-foreground">
              <Trans>
                停止服务会断开客户端并中断未完成的操作。请求和响应可在活动页的执行日志中查看；连接失败时检查端口、凭据和执行日志。
              </Trans>
            </p>
          </section>
        </DialogLayoutBody>
        <DialogLayoutFooter surface="plain">
          <Button onClick={onClose}>
            <Trans comment="关闭 MCP 使用帮助弹窗">知道了</Trans>
          </Button>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
