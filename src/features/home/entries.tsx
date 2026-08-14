import type { ComponentType, ReactNode } from "react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";
import { Plural, Trans } from "@lingui/react/macro";
import {
  Archive,
  Braces,
  Circle,
  CircleDot,
  Crown,
  Grid3x3,
  KeyRound,
  LockKeyhole,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { isMobilePlatform } from "~/lib/platform";
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

export type HomePlatform = "desktop" | "mobile";

export interface HomeEntry {
  id: string;
  category: HomeCategory;
  /** Typed link options for the entry's route. */
  link: LinkOptions;
  /** Set when entering this route should be remembered as the last used tool. */
  toolId?: ToolRoute;
  /** Platforms where the entry is available; omit for all platforms. */
  platforms?: readonly HomePlatform[];
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
          <Plural value={{ hostCount: stats.hostCount }} one="# 主机" other="# 主机" />
        </Badge>
        <Badge variant="outline">
          <Plural
            value={{ activeSessionCount: stats.activeSessionCount }}
            one="# 连接"
            other="# 连接"
          />
        </Badge>
        <Badge variant="outline">
          <Plural
            value={{ runningTransferCount: stats.runningTransferCount }}
            one="# 传输"
            other="# 传输"
          />
        </Badge>
      </>
    ),
  },
  {
    id: "lan-transfer",
    category: "tools",
    link: linkOptions({ to: "/tools/lan-transfer", preload: "intent" }),
    toolId: "lan-transfer",
    // Hidden on mobile: the LAN server/mDNS would trigger network-permission
    // prompts (iOS local network, CN wireless data) for a feature that can't
    // fully work there anyway.
    platforms: ["desktop"],
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
    id: "crypto",
    category: "tools",
    link: linkOptions({ to: "/tools/crypto", preload: "intent" }),
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
      search: { mode: "resize" },
      preload: "intent",
    }),
    toolId: "media-compress",
    icon: Archive,
    title: <Trans>媒体处理</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>压缩</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>调整图片尺寸</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>本地</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "formatter",
    category: "tools",
    link: linkOptions({ to: "/tools/formatter", preload: "intent" }),
    toolId: "formatter",
    icon: Braces,
    title: <Trans>格式化</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">JSON</Badge>
        <Badge variant="outline">
          <Trans>搜索</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "vault",
    category: "tools",
    link: linkOptions({ to: "/tools/vault", preload: "intent" }),
    toolId: "vault",
    icon: KeyRound,
    title: <Trans>密码本</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>本地</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>快速复制</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "billiards",
    category: "games",
    link: linkOptions({ to: "/games/billiards", preload: "intent" }),
    icon: CircleDot,
    title: <Trans>台球</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>人机</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>双人</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "gomoku",
    category: "games",
    link: linkOptions({ to: "/games/gomoku", preload: "intent" }),
    icon: Circle,
    title: <Trans>五子棋</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>人机</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>双人</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>联机</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "go",
    category: "games",
    link: linkOptions({ to: "/games/go", preload: "intent" }),
    icon: Grid3x3,
    title: <Trans>围棋</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>人机</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>双人</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>联机</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "xiangqi",
    category: "games",
    link: linkOptions({ to: "/games/xiangqi", preload: "intent" }),
    icon: Crown,
    title: <Trans>中国象棋</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>人机</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>双人</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>联机</Trans>
        </Badge>
      </>
    ),
  },
];

const currentPlatform: HomePlatform = isMobilePlatform() ? "mobile" : "desktop";

/** Home entries available on the current platform. */
export const availableHomeEntries: HomeEntry[] = homeEntries.filter(
  (entry) => !entry.platforms || entry.platforms.includes(currentPlatform),
);

export function getToolEntry(tool: ToolRoute): HomeEntry | undefined {
  return availableHomeEntries.find((entry) => entry.toolId === tool);
}
