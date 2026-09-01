import { useForm } from "@tanstack/react-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { z } from "zod";
import { CheckCircle2, RefreshCw, Shield, ShieldOff } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { LanAuthRequest } from "~/types";
import { formatRelativeTime } from "~/lib/relative-time";
import { lanPermissionLabel } from "~/features/lan-transfer/labels";
interface Props {
  requests: LanAuthRequest[];
  refreshing: boolean;
  refresh: () => void;
  approve: (id: string, permission: string) => void;
  reject: (id: string) => void;
}
const permissionFormSchema = z.object({
  permission: z.enum(["readOnly", "readWrite", "uploadOnly"]),
});
function LanAuthRequestPermissionForm({
  request,
  approve,
}: {
  request: LanAuthRequest;
  approve: (id: string, permission: string) => void;
}) {
  const form = useForm({
    defaultValues: {
      permission: "readWrite",
    },
    validators: {
      onSubmit: permissionFormSchema,
    },
    onSubmit: ({ value }) => {
      approve(request.id, value.permission);
    },
  });
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <form.Field name="permission">
        {(field) => (
          <Select
            value={field.state.value}
            onValueChange={(value) => {
              if (
                value === "readOnly" ||
                value === "readWrite" ||
                value === "uploadOnly"
              ) {
                field.handleChange(value);
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="readOnly">
                  <Trans>只读</Trans>
                </SelectItem>
                <SelectItem value="readWrite">
                  <Trans>读写</Trans>
                </SelectItem>
                <SelectItem value="uploadOnly">
                  <Trans>仅上传</Trans>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </form.Field>
      <Button onClick={() => void form.handleSubmit()}>
        <CheckCircle2 data-icon="inline-start" />
        <Trans>允许</Trans>
      </Button>
    </div>
  );
}
export default function LanPendingAuthRequestsPanel({
  requests,
  refreshing,
  refresh,
  approve,
  reject,
}: Props) {
  const { t } = useLingui();
  const sorted = [...requests].sort((a, b) => b.requestedAt - a.requestedAt);
  return (
    <section className="border-border bg-card flex flex-col rounded-lg border">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            <Trans>待授权请求</Trans>
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            <Trans>浏览器访问申请、弹窗确认和白名单回落请求</Trans>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={refreshing ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          <Trans>刷新</Trans>
        </Button>
      </div>
      <div className="p-2">
        {sorted.length === 0 ? (
          <div className="border-border text-muted-foreground flex min-h-24 items-center justify-center rounded-md border border-dashed text-xs">
            <Trans>暂无待授权请求</Trans>
          </div>
        ) : (
          <div className="grid gap-1.5">
            {sorted.map((request) => {
              return (
                <div
                  key={request.id}
                  className="border-border grid gap-2 rounded-md border px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Shield className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="truncate text-sm font-medium">
                          {request.deviceName}
                        </span>
                        <Badge variant="outline">
                          {lanPermissionLabel(request.accessType)}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-0.5 truncate text-xs">
                        {request.ip} · {formatRelativeTime(request.requestedAt)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title={t`拒绝访问`}
                      aria-label={t`拒绝访问`}
                      className="max-sm:min-h-11 max-sm:min-w-11"
                      onClick={() => void reject(request.id)}
                    >
                      <ShieldOff className="text-destructive" />
                    </Button>
                  </div>
                  <LanAuthRequestPermissionForm
                    request={request}
                    approve={approve}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
