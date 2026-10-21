import { Trans } from "@lingui/react/macro";
import {
  KeyRound,
  ListTodo,
  type LucideIcon,
  Server,
  Sparkles,
  Wifi,
} from "lucide-react";
import type { ReactNode } from "react";

import type { ExportSection } from "~/bindings";

export interface ExportSectionMeta {
  id: ExportSection;
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
}

/** 可导出数据分区的注册表；每个新模块在此添加一条。 */
export const exportSections: ExportSectionMeta[] = [
  {
    id: "vault",
    icon: KeyRound,
    title: <Trans>密码本</Trans>,
    description: <Trans>标题、网址、账号、密码、分类、备注</Trans>,
  },
  {
    id: "hosts",
    icon: Server,
    title: <Trans>主机</Trans>,
    description: <Trans>SSH / SFTP 主机连接配置</Trans>,
  },
  {
    id: "todo",
    icon: ListTodo,
    title: <Trans>待办</Trans>,
    description: (
      <Trans>标题、分类、备注文本、图片、代码块、日期和完成状态</Trans>
    ),
  },
  {
    id: "lan",
    icon: Wifi,
    title: <Trans>局域网</Trans>,
    description: <Trans>传输设置、共享目录和信任设备</Trans>,
  },
  {
    id: "aiTranslations",
    icon: Sparkles,
    title: <Trans>AI 译文</Trans>,
    description: <Trans>AI 生成及人工修订的诗词译文，不包含 API Key</Trans>,
  },
];
