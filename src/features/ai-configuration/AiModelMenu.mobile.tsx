import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Bot, Check } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import { describeError } from "~/lib/errors";

import { useAiConfiguration } from "./store";

/** 窄屏用独立面板，避免嵌套菜单碰撞后只剩很窄的可用宽度。 */
export default function AiModelMenuMobile() {
  const [open, setOpen] = useState(false);
  const { view, loading, busy, error, refresh, switchModel } =
    useAiConfiguration();
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          setOpen(true);
          void refresh();
        }}
      >
        <Bot />
        <Trans>AI 模型</Trans>
      </DropdownMenuItem>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogLayoutContent
          placement="responsive-sheet"
          showCloseButton={false}
          aria-describedby={undefined}
          className="ui-density-adaptive"
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>AI 模型</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody className="flex flex-col gap-3">
            {loading ? (
              <p role="status" className="text-muted-foreground text-sm">
                <Trans>正在加载</Trans>
              </p>
            ) : null}
            {error ? (
              <div className="flex flex-col gap-2">
                <p role="alert" className="text-destructive text-sm">
                  {describeError(error)}
                </p>
                <Button
                  variant="outline"
                  fullWidth
                  disabled={loading || busy}
                  onClick={() => void refresh()}
                >
                  <Trans>重新加载</Trans>
                </Button>
              </div>
            ) : null}
            {view && !view.activeProviderId ? (
              <p className="text-muted-foreground text-sm">
                <Trans>未启用服务地址</Trans>
              </p>
            ) : null}
            {view?.providers.map((provider) => (
              <section key={provider.id} className="border-b pb-2">
                <h3 className="flex min-w-0 items-center justify-between gap-2 text-sm font-medium">
                  <span className="truncate">{provider.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {provider.id === view.activeProviderId ? (
                      <Trans>当前地址</Trans>
                    ) : (
                      <Trans>非当前地址</Trans>
                    )}
                  </span>
                </h3>
                {provider.models.map((model) => (
                  <Button
                    key={model.id}
                    variant="ghost"
                    fullWidth
                    className="h-auto min-h-[max(44px,2.75rem)] justify-between py-2 text-left font-normal"
                    disabled={
                      busy ||
                      loading ||
                      !!error ||
                      provider.id !== view.activeProviderId ||
                      provider.requiresAddressRepair
                    }
                    aria-pressed={
                      provider.id === view.activeProviderId &&
                      provider.currentModelId === model.id
                    }
                    onClick={() =>
                      void switchModel({
                        expectedRevision: view.revision,
                        expectedActiveProviderId: provider.id,
                        modelId: model.id,
                      })
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {model.displayName || model.modelId}
                      </span>
                      {model.displayName ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {model.modelId}
                        </span>
                      ) : null}
                    </span>
                    {provider.id === view.activeProviderId &&
                    provider.currentModelId === model.id ? (
                      <Check />
                    ) : null}
                  </Button>
                ))}
              </section>
            ))}
            <Button variant="outline" fullWidth asChild>
              <Link
                to="/settings"
                search={{ panel: "ai" }}
                onClick={() => setOpen(false)}
              >
                <Trans>管理 AI 配置</Trans>
              </Link>
            </Button>
          </DialogLayoutBody>
        </DialogLayoutContent>
      </Dialog>
    </>
  );
}
