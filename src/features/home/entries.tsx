import type { ComponentType, ReactNode } from "react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  Archive,
  Braces,
  Circle,
  CircleDot,
  Crown,
  Grid3x3,
  HardDrive,
  KeyRound,
  LockKeyhole,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { isMacPlatform, isMobilePlatform } from "~/lib/platform";
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

export type HomePlatform = "desktop" | "mobile" | "macos";

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
      search: { mode: "resize" },
      preload: "viewport",
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
          <Trans>改尺寸</Trans>
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
    link: linkOptions({ to: "/tools/formatter", preload: "viewport" }),
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
    link: linkOptions({ to: "/tools/vault", preload: "viewport" }),
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
    id: "disk-clean",
    category: "tools",
    link: linkOptions({ to: "/tools/disk-clean", preload: "viewport" }),
    toolId: "disk-clean",
    // macOS only: the backend registers no disk_clean_* commands elsewhere,
    // so the page would fail at the IPC layer rather than degrade.
    platforms: ["macos"],
    icon: HardDrive,
    title: <Trans>磁盘清理</Trans>,
    badges: () => (
      <>
        <Badge variant="outline">
          <Trans>缓存</Trans>
        </Badge>
        <Badge variant="outline">
          <Trans>废纸篓</Trans>
        </Badge>
      </>
    ),
  },
  {
    id: "billiards",
    category: "games",
    link: linkOptions({ to: "/games/billiards", preload: "viewport" }),
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
    link: linkOptions({ to: "/games/gomoku", preload: "viewport" }),
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
    link: linkOptions({ to: "/games/go", preload: "viewport" }),
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
    link: linkOptions({ to: "/games/xiangqi", preload: "viewport" }),
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

// macOS satisfies both "desktop" and "macos", so membership is a set rather
// than a single value — a macOS-only entry must not appear on Windows/Linux,
// where the backend registers no commands for it.
const currentPlatforms: readonly HomePlatform[] = isMobilePlatform()
  ? ["mobile"]
  : isMacPlatform()
    ? ["desktop", "macos"]
    : ["desktop"];

/** Home entries available on the current platform. */
export const availableHomeEntries: HomeEntry[] = homeEntries.filter(
  (entry) =>
    !entry.platforms ||
    entry.platforms.some((platform) => currentPlatforms.includes(platform)),
);

export function getToolEntry(tool: ToolRoute): HomeEntry | undefined {
  return availableHomeEntries.find((entry) => entry.toolId === tool);
}
