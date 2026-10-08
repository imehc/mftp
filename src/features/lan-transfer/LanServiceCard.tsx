import { Trans, useLingui } from "@lingui/react/macro";
import { Monitor, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "~/components/CopyButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { DialogLayoutHeader } from "~/components/ui/dialog-layout";
import { describeError } from "~/lib/errors";
import type { LanTransferSettings, LanTransferStatus } from "~/types";

export default function LanServiceCard({
  settings,
  status,
}: {
  settings: LanTransferSettings;
  status: LanTransferStatus | null;
}) {
  const { t } = useLingui();
  const onlineConnections = status?.running ? status.onlineConnections : 0;
  const [qrOpen, setQrOpen] = useState(false);
  return (
    <section className="border-border bg-card rounded-lg border p-3">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">
          <Trans>本机服务</Trans>
        </h2>
      </header>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Monitor className="text-muted-foreground size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {settings.deviceName || t`局域网传输`}
            </p>
            <p className="text-muted-foreground text-xs break-all">
              {status?.url || t`启动服务后显示浏览器访问地址`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton
              variant="outline"
              size="sm"
              value={status?.url ?? ""}
              disabled={!status?.url}
              showLabel
              label={t`复制地址`}
              onError={(error) => toast.error(describeError(error))}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`扫码访问`}
              disabled={!status?.url}
              onClick={() => setQrOpen(true)}
            >
              <QrCode />
            </Button>
          </div>
        </div>
        <div className="border-border flex items-center justify-between gap-3 border-t pt-3">
          <div className="min-w-0 text-xs">
            <p className="font-medium">
              <Trans>连接确认码</Trans>
            </p>
            <p className="text-muted-foreground mt-1 tabular-nums">
              {status?.running ? status.confirmationCode || "—" : "—"}
            </p>
          </div>
          <Badge variant="secondary">
            <Trans>{onlineConnections} 个在线连接</Trans>
          </Badge>
        </div>
      </div>
      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent
          className="ui-density-adaptive max-w-sm"
          showCloseButton={false}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>
              <Trans>扫码访问</Trans>
            </DialogTitle>
          </DialogLayoutHeader>
          {status?.url ? (
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={status.url} className="size-48" />
              <p className="text-muted-foreground text-xs break-all">
                {status.url}
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
