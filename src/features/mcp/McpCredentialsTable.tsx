import { Trans, useLingui } from "@lingui/react/macro";
import { Check, Minus, MoreHorizontal, Plus } from "lucide-react";
import { useId } from "react";

import type { McpCredential } from "~/bindings";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { clientPermission } from "./credential-permissions";
import type { CredentialAction } from "./McpCredentialDialogs";

export default function McpCredentialsTable({
  credentials,
  disabled,
  available,
  onAdd,
  onEdit,
  onAction,
}: {
  credentials: McpCredential[];
  disabled: boolean;
  available: boolean;
  onAdd: () => void;
  onEdit: (credential: McpCredential) => void;
  onAction: (action: CredentialAction) => void;
}) {
  const { t } = useLingui();
  const prefix = useId();
  const clientCount = credentials.length;

  return (
    <section aria-labelledby={`${prefix}-heading`} className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id={`${prefix}-heading`} className="mr-auto text-sm font-semibold">
          <Trans>客户端授权</Trans>
          <span className="text-muted-foreground ml-2 font-normal">
            <Trans comment="客户端授权总数，不是模块工具数量">
              {clientCount} 个客户端
            </Trans>
          </span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || credentials.length >= 16}
          title={credentials.length >= 16 ? t`最多授权 16 个客户端` : undefined}
          onClick={onAdd}
        >
          <Plus data-icon="inline-start" />
          <Trans>添加授权</Trans>
        </Button>
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table aria-label={t`MCP 客户端授权列表`}>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead
                scope="col"
                rowSpan={2}
                className="border-r border-b text-xs"
              >
                <Trans comment="MCP 授权记录名称，用来区分外部客户端，不是密钥本身">
                  授权名称
                </Trans>
              </TableHead>
              <TableHead
                id={`${prefix}-permissions`}
                scope="colgroup"
                colSpan={3}
                className="h-8 border-r text-center text-xs"
              >
                <Trans comment="MCP 授权表与编辑弹窗的权限组标题">权限</Trans>
              </TableHead>
              <TableHead
                scope="col"
                rowSpan={2}
                className="w-12 border-b text-center text-xs"
              >
                <Trans comment="客户端授权表的行操作列">操作</Trans>
              </TableHead>
            </TableRow>
            <TableRow className="bg-muted/40">
              <TableHead
                scope="col"
                headers={`${prefix}-permissions`}
                className="h-8 w-16 border-r text-center text-xs"
              >
                <Trans comment="MCP 全部模块的读取权限，复选框与授权表头共用">
                  读取
                </Trans>
              </TableHead>
              <TableHead
                scope="col"
                headers={`${prefix}-permissions`}
                className="h-8 w-16 border-r text-center text-xs"
              >
                <Trans comment="MCP 全部模块的新建和编辑权限，不包含删除，复选框与授权表头共用">
                  写入
                </Trans>
              </TableHead>
              <TableHead
                scope="col"
                headers={`${prefix}-permissions`}
                className="h-8 w-16 border-r text-center text-xs"
              >
                <Trans comment="MCP 全部模块的删除权限，必须单独勾选，复选框与授权表头共用">
                  删除
                </Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((credential) => {
              const name = credential.name;
              const permission = clientPermission(credential);
              return (
                <TableRow key={credential.id}>
                  <TableHead
                    scope="row"
                    className="max-w-48 border-r py-1.5 text-xs"
                  >
                    <span className="block max-w-48 truncate" title={name}>
                      {name}
                    </span>
                    {!permission.global ? (
                      <span className="text-muted-foreground block text-xs font-normal">{t`旧版授权（需更新）`}</span>
                    ) : null}
                  </TableHead>
                  {(["read", "write", "delete"] as const).map((key) => (
                    <TableCell
                      key={key}
                      className="border-r py-1.5 text-center"
                    >
                      <span
                        role="img"
                        aria-label={
                          !permission.uniform
                            ? t`权限不一致，需更新授权`
                            : permission.grant?.[key]
                              ? t({
                                  message: "已授权",
                                  comment:
                                    "MCP 授权表中勾号的无障碍说明，表示此项权限已开启",
                                })
                              : t({
                                  message: "未授权",
                                  comment:
                                    "MCP 授权表中横线的无障碍说明，表示此项权限未开启",
                                })
                        }
                        className="inline-flex align-middle"
                      >
                        {permission.grant?.[key] ? (
                          <Check aria-hidden="true" className="size-4" />
                        ) : (
                          <Minus
                            aria-hidden="true"
                            className="text-muted-foreground size-4"
                          />
                        )}
                      </span>
                    </TableCell>
                  ))}
                  <TableCell className="py-1.5 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled}
                          aria-label={t({
                            message: `管理授权 ${name}`,
                            comment:
                              "客户端授权表的行菜单名称，name 是客户端授权名称",
                          })}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onEdit(credential)}>
                          <Trans>编辑权限</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            onAction({ kind: "rotate", credential })
                          }
                        >
                          <Trans>重新生成凭据</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() =>
                            onAction({ kind: "revoke", credential })
                          }
                        >
                          <Trans>撤销授权</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {!credentials.length ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground text-xs whitespace-normal"
                >
                  {available
                    ? t`尚未授权客户端，添加授权后可连接服务。`
                    : t`授权记录暂不可用，请重新读取设置。`}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
