import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import type { ExportSection } from "~/bindings";
export interface ExportSectionMeta {
  id: ExportSection;
  title: ReactNode;
  description: ReactNode;
}

/** 可导出数据分区的注册表；每个新模块在此添加一条。 */
export const exportSections: ExportSectionMeta[] = [
  {
    id: "vault",
    title: <Trans>密码本</Trans>,
    description: <Trans>标题、网址、账号、密码、分类、备注</Trans>,
  },
  {
    id: "hosts",
    title: <Trans>主机</Trans>,
    description: <Trans>SSH / SFTP 主机连接配置</Trans>,
  },
  {
    id: "todo",
    title: <Trans>待办</Trans>,
    description: <Trans>标题、分类、备注、日期和完成状态</Trans>,
  },
  {
    id: "lan",
    title: <Trans>局域网</Trans>,
    description: <Trans>传输设置、共享目录和信任设备</Trans>,
  },
];
