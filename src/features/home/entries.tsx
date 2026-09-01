import type { ComponentType, ReactNode } from "react";
import { linkOptions, type LinkOptions } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import {
  Archive,
  BookMarked,
  Braces,
  Circle,
  CircleDot,
  Crown,
  Grid3x3,
  KeyRound,
  LockKeyhole,
  Magnet,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import { isMobilePlatform } from "~/lib/platform";
import type { ToolRoute } from "~/store/settings";
export type HomeCategory = "tools" | "library" | "games";
export const homeCategoryLabels: Record<HomeCategory, ReactNode> = {
  tools: <Trans>工具</Trans>,
  library: <Trans>文库</Trans>,
  games: <Trans>小游戏</Trans>,
};
export type HomePlatform = "desktop" | "mobile";
export interface HomeEntry {
  id: string;
  category: HomeCategory;
  /** 该入口路由的带类型 link 配置。 */
  link: LinkOptions;
  /** 进入该路由时若需记住为上次使用的工具，则设置。 */
  toolId?: ToolRoute;
  /** 该入口可用的平台；省略表示全平台可用。 */
  platforms?: readonly HomePlatform[];
  icon: ComponentType<{
    className?: string;
  }>;
  title: ReactNode;
}
export const homeEntries: HomeEntry[] = [
  {
    id: "ssh-sftp",
    category: "tools",
    link: linkOptions({
      to: "/tools/ssh-sftp",
    }),
    toolId: "ssh-sftp",
    icon: TerminalSquare,
    title: "SSH / SFTP",
  },
  {
    id: "lan-transfer",
    category: "tools",
    link: linkOptions({
      to: "/tools/lan-transfer",
      preload: "intent",
    }),
    toolId: "lan-transfer",
    // 移动端隐藏：局域网服务 / mDNS 会触发网络权限弹窗
    //（iOS 本地网络、国内无线数据），而该功能在移动端本就无法完整使用。
    platforms: ["desktop"],
    icon: Wifi,
    title: <Trans>局域网传输</Trans>,
  },
  {
    id: "crypto",
    category: "tools",
    link: linkOptions({
      to: "/tools/crypto",
      preload: "intent",
    }),
    toolId: "crypto",
    icon: LockKeyhole,
    title: <Trans>加解密</Trans>,
  },
  {
    id: "media-compress",
    category: "tools",
    link: linkOptions({
      to: "/tools/media-compress",
      search: {
        mode: "resize",
      },
      preload: "intent",
    }),
    toolId: "media-compress",
    icon: Archive,
    title: <Trans>媒体处理</Trans>,
  },
  {
    id: "formatter",
    category: "tools",
    link: linkOptions({
      to: "/tools/formatter",
      preload: "intent",
    }),
    toolId: "formatter",
    icon: Braces,
    title: <Trans>格式化</Trans>,
  },
  {
    id: "vault",
    category: "tools",
    link: linkOptions({
      to: "/tools/vault",
      preload: "intent",
    }),
    toolId: "vault",
    icon: KeyRound,
    title: <Trans>密码本</Trans>,
  },
  {
    id: "bt",
    category: "tools",
    link: linkOptions({
      to: "/tools/bt",
      preload: "intent",
    }),
    toolId: "bt",
    // BT 引擎在各平台都能编译，但下载页尚无
    // 移动端布局。
    platforms: ["desktop"],
    icon: Magnet,
    title: <Trans>BT 下载</Trans>,
  },
  {
    id: "library",
    category: "library",
    link: linkOptions({
      to: "/library",
      preload: "intent",
    }),
    toolId: "library",
    // 目前仅桌面端：主从布局尚无对应的
    // 移动端版本（D8）。
    platforms: ["desktop"],
    icon: BookMarked,
    title: <Trans>古诗词</Trans>,
  },
  {
    id: "billiards",
    category: "games",
    link: linkOptions({
      to: "/games/billiards",
      preload: "intent",
    }),
    icon: CircleDot,
    title: <Trans>台球</Trans>,
  },
  {
    id: "gomoku",
    category: "games",
    link: linkOptions({
      to: "/games/gomoku",
      preload: "intent",
    }),
    icon: Circle,
    title: <Trans>五子棋</Trans>,
  },
  {
    id: "go",
    category: "games",
    link: linkOptions({
      to: "/games/go",
      preload: "intent",
    }),
    icon: Grid3x3,
    title: <Trans>围棋</Trans>,
  },
  {
    id: "xiangqi",
    category: "games",
    link: linkOptions({
      to: "/games/xiangqi",
      preload: "intent",
    }),
    icon: Crown,
    title: <Trans>中国象棋</Trans>,
  },
];
const currentPlatform: HomePlatform = isMobilePlatform() ? "mobile" : "desktop";

/** 当前平台可用的首页入口。 */
export const availableHomeEntries: HomeEntry[] = homeEntries.filter(
  (entry) => !entry.platforms || entry.platforms.includes(currentPlatform),
);
export function getToolEntry(tool: ToolRoute): HomeEntry | undefined {
  return availableHomeEntries.find((entry) => entry.toolId === tool);
}
