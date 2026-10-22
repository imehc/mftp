import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { filterTools, type PresentedModule } from "./catalog-presentation";
import McpModuleFilter from "./McpModuleFilter";

export default function McpToolsTable({
  modules,
  available,
  onCopyError,
}: {
  modules: PresentedModule[];
  available: boolean;
  onCopyError: (error: unknown) => void;
}) {
  const { t } = useLingui();
  const prefix = useId();
  const [query, setQuery] = useState("");
  const [moduleId, setModuleId] = useState("all");
  const filtered = filterTools(modules, moduleId, query);
  const count = modules.reduce(
    (total, module) => total + module.tools.length,
    0,
  );

  return (
    <section aria-labelledby={`${prefix}-heading`} className="min-w-0">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <h2 id={`${prefix}-heading`} className="mr-auto text-sm font-semibold">
          <Trans>可用工具</Trans>
          <span className="text-muted-foreground ml-2 font-normal">
            {count}
          </span>
        </h2>
        <McpModuleFilter
          modules={modules}
          value={moduleId}
          onChange={setModuleId}
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t`搜索工具名称或调用名称`}
          placeholder={t`搜索名称或调用名称`}
          className="w-48 max-w-full"
        />
      </div>
      <div className="overflow-hidden rounded-md border">
        <Table aria-label={t`按模块分组的 MCP 工具目录`}>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead
                id={`${prefix}-module`}
                rowSpan={2}
                scope="col"
                className="bg-background sticky left-0 z-10 border-r border-b text-xs"
              >
                <Trans comment="MCP 工具目录第一列，工具所属业务模块">
                  模块
                </Trans>
              </TableHead>
              <TableHead
                id={`${prefix}-info`}
                colSpan={2}
                scope="colgroup"
                className="h-8 border-r text-xs"
              >
                <Trans>工具信息</Trans>
              </TableHead>
              <TableHead
                id={`${prefix}-requirement`}
                scope="colgroup"
                className="h-8 border-l text-xs"
              >
                <Trans>调用要求</Trans>
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead
                id={`${prefix}-title`}
                headers={`${prefix}-info`}
                scope="col"
                className="h-8 border-r text-xs"
              >
                <Trans comment="MCP 工具的可读名称，而非协议调用名">名称</Trans>
              </TableHead>
              <TableHead
                id={`${prefix}-name`}
                headers={`${prefix}-info`}
                scope="col"
                className="h-8 border-r text-xs"
              >
                <Trans>调用名称</Trans>
              </TableHead>
              <TableHead
                id={`${prefix}-permission`}
                headers={`${prefix}-requirement`}
                scope="col"
                className="h-8 border-l text-xs"
              >
                <Trans>所需权限</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          {filtered.map((module) => (
            <TableBody key={module.id}>
              {module.tools.map((tool, index) => {
                const name = tool.name;
                return (
                  <TableRow
                    key={name}
                    className={index === 0 ? "border-t" : undefined}
                  >
                    {index === 0 ? (
                      <TableHead
                        id={`${prefix}-${module.id}`}
                        headers={`${prefix}-module`}
                        scope="rowgroup"
                        rowSpan={module.tools.length}
                        className="bg-background sticky left-0 z-10 border-r pt-3 align-top text-xs font-semibold"
                      >
                        {module.title}
                        <span className="text-muted-foreground ml-2 font-normal">
                          {module.tools.length}
                        </span>
                      </TableHead>
                    ) : null}
                    <TableCell
                      headers={`${prefix}-${module.id} ${prefix}-info ${prefix}-title`}
                      className="border-r py-1.5 text-xs"
                    >
                      {tool.title}
                    </TableCell>
                    <TableCell
                      headers={`${prefix}-${module.id} ${prefix}-info ${prefix}-name`}
                      className="border-r py-1.5"
                    >
                      <div className="flex items-center gap-1">
                        <code className="text-xs">{name}</code>
                        <CopyButton
                          variant="ghost"
                          size="icon-sm"
                          value={name}
                          label={t({
                            message: `复制调用名 ${name}`,
                            comment: "复制 MCP 工具协议调用名，name 是工具名",
                          })}
                          onError={onCopyError}
                        />
                      </div>
                    </TableCell>
                    <TableCell
                      headers={`${prefix}-${module.id} ${prefix}-requirement ${prefix}-permission`}
                      className="border-l py-1.5"
                    >
                      <Badge variant="secondary">
                        {tool.permission === "delete"
                          ? t({
                              message: "删除",
                              comment: "MCP 工具所需的独立删除权限",
                            })
                          : tool.permission === "write"
                            ? t({
                                message: "编辑",
                                comment:
                                  "MCP 工具需要读取、新建和编辑权限，不包含删除",
                              })
                            : t({
                                message: "读取",
                                comment: "MCP 工具仅需要读取权限",
                              })}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          ))}
          {!filtered.length ? (
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground text-xs whitespace-normal"
                >
                  {!available ? (
                    t`工具目录暂不可用，请重新读取设置。`
                  ) : query || moduleId !== "all" ? (
                    <div className="flex items-center justify-between gap-2">
                      <Trans>没有匹配的工具</Trans>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setQuery("");
                          setModuleId("all");
                        }}
                      >
                        <Trans>清除筛选</Trans>
                      </Button>
                    </div>
                  ) : (
                    t`尚未注册工具`
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          ) : null}
        </Table>
      </div>
    </section>
  );
}
