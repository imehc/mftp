import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import type { ExportSection } from "~/bindings";

export interface ExportSectionMeta {
  id: ExportSection;
  title: ReactNode;
  description: ReactNode;
}

/** Registry of exportable data sections; add one entry per new module. */
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
];
