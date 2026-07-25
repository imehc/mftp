import type { ComponentType, ReactNode } from "react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  Archive,
  Globe,
  LockKeyhole,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import type { ToolRoute } from "~/store/settings";

export interface HomeStats {
  hostCount: number;
  activeSessionCount: number;
  runningTransferCount: number;
}

export type HomeCategory = "tools" | "games";

export const homeCategoryLabels: Record<HomeCategory, ReactNode> = {
  tools: <Trans>工具</Trans>,
  games: <Trans>小游戏</Trans>,
};

export interface HomeEntry {
  id: string;
  category: HomeCategory;
  /** Typed link options for the entry's route. */
  link: LinkOptions;
  /** Set when entering this route should be remembered as the last used tool. */
  toolId?: ToolRoute;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  badges?: (stats: HomeStats) => ReactNode;
}

export const homeEntries: HomeEntry[] = [
  {
    id: "ssh-sftp",
    category: "tools",
    link: linkOptions({ to: "/tools/ssh-sftp" }),
    toolId: "ssh-sftp",
    icon: TerminalSquare,
    title: "SSH / SFTP",
    badges: (stats) => (
      <>
        <Badge variant="outline">
          <Trans>{stats.hostCount} 主机</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>{stats.activeSessionCount} 连接</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>{stats.runningTransferCount} 传输</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "lan-transfer",
    category: "tools",
    link: linkOptions({ to: "/tools/lan-transfer", preload: "viewport" }),
    toolId: "lan-transfer",
    icon: Wifi,
    title: <Trans>局域网传输</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">HTTP</Badge>
        <Badge variant="outline">
          <Trans>浏览器访问</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "web-browser",
    category: "tools",
    link: linkOptions({ to: "/tools/web-browser", preload: "viewport" }),
    toolId: "web-browser",
    icon: Globe,
    title: <Trans>网页访问</Trans>,
    badges: () => (
      <Badge variant="outline">
        <Trans>数据连接</Trans>
      </Badge>
    ),
  },
  {
    id: "crypto",
    category: "tools",
    link: linkOptions({ to: "/tools/crypto", preload: "viewport" }),
    toolId: "crypto",
    icon: LockKeyhole,
    title: <Trans>加解密</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>编码</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>解码</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "media-compress",
    category: "tools",
    link: linkOptions({
      to: "/tools/media-compress",
      search: { mode: "image" },
      preload: "viewport",
    }),
    toolId: "media-compress",
    icon: Archive,
    title: <Trans>媒体压缩</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>图片</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>视频</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>本地</Trans>
        </Badge>
      </>
    ),
  },
];

export function getToolEntry(tool: ToolRoute): HomeEntry | undefined {
  return homeEntries.find((entry) => entry.toolId === tool);
}
