import { useMemo } from "react";
import { useForm } from "@tanstack/react-form";
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

interface Props {
  requests: LanAuthRequest[];
  refreshing: boolean;
  refresh: () => void;
  approve: (id: string, permission: string) => void;
  reject: (id: string) => void;
}

function permissionLabel(value: string) {
  if (value === "readOnly") return "只读";
  if (value === "uploadOnly") return "仅上传";
  return "读写";
}

function formatAge(value: number) {
  if (!value) return "-";
  const diff = Math.max(0, Date.now() - value);
  if (diff < 60_000) return `${Math.max(1, Math.ceil(diff / 1000))} 秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return `${Math.floor(diff / 3_600_000)} 小时前`;
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
    defaultValues: { permission: "readWrite" },
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
                <SelectItem value="readOnly">只读</SelectItem>
                <SelectItem value="readWrite">读写</SelectItem>
                <SelectItem value="uploadOnly">仅上传</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </form.Field>
      <Button onClick={() => void form.handleSubmit()}>
        <CheckCircle2 data-icon="inline-start" />
        允许
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
  const sorted = useMemo(
    () => [...requests].sort((a, b) => b.requestedAt - a.requestedAt),
    [requests],
  );

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">待授权请求</h2>
          <p className="truncate text-xs text-muted-foreground">
            浏览器访问申请、弹窗确认和白名单回落请求
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} data-icon="inline-start" />
          刷新
        </Button>
      </div>
      <div className="p-2">
        {sorted.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            暂无待授权请求
          </div>
        ) : (
          <div className="grid gap-1.5">
            {sorted.map((request) => {
              return (
                <div
                  key={request.id}
                  className="grid gap-2 rounded-md border border-border px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Shield className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">
                          {request.deviceName}
                        </span>
                        <Badge variant="outline">{permissionLabel(request.accessType)}</Badge>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {request.ip} · {formatAge(request.requestedAt)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void reject(request.id)}
                    >
                      <ShieldOff className="text-destructive" />
                    </Button>
                  </div>
                  <LanAuthRequestPermissionForm request={request} approve={approve} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
