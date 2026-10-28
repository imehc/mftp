import { Trans } from "@lingui/react/macro";
import { type LinkOptions, linkOptions } from "@tanstack/react-router";
import {
  Archive,
  BookMarked,
  Box,
  Braces,
  Circle,
  CircleDot,
  Crown,
  Cuboid,
  Flag,
  Grid3x3,
  KeyRound,
  Languages,
  ListTodo,
  LockKeyhole,
  Magnet,
  TerminalSquare,
  Wifi,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import {
  moduleAvailableOn,
  moduleForTool,
  type ModuleId,
  moduleMetadata,
  type ModulePlatform,
  type ToolRoute,
} from "~/lib/module-metadata";
import {
  isAndroidPlatform,
  isIosPlatform,
  isMobilePlatform,
} from "~/lib/platform";
import type { HomeCategoryId, HomeEntryVisibility } from "~/store/settings";

export type HomeCategory = "tools" | "library" | "games";

export const homeCategoryLabels: Record<HomeCategory, ReactNode> = {
  tools: <Trans>工具</Trans>,
  library: <Trans>文库</Trans>,
  games: <Trans>小游戏</Trans>,
};

/** 首页按平台筛选；平台/能力的事实来源是模块元数据。 */
export type HomePlatform = ModulePlatform;

export interface HomeEntry {
  /** 稳定模块 id；平台能力与 lastTool 恢复从模块元数据读取。 */
  id: ModuleId;
  category: HomeCategory;
  /** 该入口路由的带类型 link 配置。 */
  link: LinkOptions;
  icon: ComponentType<{
    className?: string;
  }>;
  title: ReactNode;
}

export const homeEntries: HomeEntry[] = [
  {
    id: "model-viewer",
    category: "tools",
    link: linkOptions({ to: "/tools/model-viewer", preload: "intent" }),
    icon: Box,
    title: (
      <Trans comment="本地 GLB/glTF 三维模型查看工具名称。">3D 模型</Trans>
    ),
  },
  {
    id: "ssh-sftp",
    category: "tools",
    link: linkOptions({
      to: "/tools/ssh-sftp",
    }),
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
    icon: Braces,
    title: <Trans>格式化</Trans>,
  },
  {
    id: "translation",
    category: "tools",
    link: linkOptions({
      to: "/tools/translation",
      preload: "intent",
    }),
    icon: Languages,
    title: <Trans>翻译</Trans>,
  },
  {
    id: "vault",
    category: "tools",
    link: linkOptions({
      to: "/tools/vault",
      preload: "intent",
    }),
    icon: KeyRound,
    title: <Trans>密码本</Trans>,
  },
  {
    id: "todo",
    category: "tools",
    link: linkOptions({
      to: "/tools/todo",
      preload: "intent",
    }),
    icon: ListTodo,
    title: <Trans>待办事项</Trans>,
  },
  {
    id: "bt",
    category: "tools",
    link: linkOptions({
      to: "/tools/bt",
      preload: "intent",
    }),
    icon: Magnet,
    title: <Trans>BT 下载</Trans>,
  },
  {
    id: "library",
    category: "library",
    link: linkOptions({
      to: "/library",
      search: { resume: true },
      preload: "intent",
    }),
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
  {
    id: "junqi",
    category: "games",
    link: linkOptions({ to: "/games/junqi", preload: "intent" }),
    icon: Flag,
    title: <Trans>陆战棋</Trans>,
  },
  {
    id: "magic-cube",
    category: "games",
    link: linkOptions({ to: "/games/magic-cube", preload: "intent" }),
    icon: Cuboid,
    title: <Trans comment="小游戏名称，指可转动的多阶立方体谜题">魔方</Trans>,
  },
  {
    id: "sliding-puzzle",
    category: "games",
    link: linkOptions({ to: "/games/sliding-puzzle", preload: "intent" }),
    icon: Grid3x3,
    title: (
      <Trans comment="小游戏名，滑动数字方块填入空位并排序">数字华容道</Trans>
    ),
  },
];
export const currentHomePlatform: HomePlatform = isAndroidPlatform()
  ? "android"
  : isIosPlatform()
    ? "ios"
    : isMobilePlatform()
      ? "mobile"
      : "desktop";

/** 当前平台可用的首页入口；平台能力来自模块元数据。 */
export function homeEntriesForPlatform(platform: HomePlatform): HomeEntry[] {
  return homeEntries.filter((entry) => {
    const module = moduleMetadata(entry.id);
    return module && moduleAvailableOn(module, platform);
  });
}

export const availableHomeEntries = homeEntriesForPlatform(currentHomePlatform);

/** 将持久化顺序与当前平台可用入口稳定合并，新增入口追加到默认顺序末尾。 */
export function orderedHomeEntries(
  category: HomeCategory,
  saved: string[] = [],
  entries: HomeEntry[] = availableHomeEntries,
): HomeEntry[] {
  const categoryEntries = entries.filter(
    (entry) => entry.category === category,
  );
  const byId = new Map<string, HomeEntry>(
    categoryEntries.map((entry) => [entry.id, entry]),
  );
  const ordered = saved.flatMap((id) => {
    const entry = byId.get(id);
    if (!entry) return [];
    byId.delete(id);
    return [entry];
  });
  return [...ordered, ...categoryEntries.filter((entry) => byId.has(entry.id))];
}

export function visibleHomeEntries(
  category: HomeCategory,
  visibility: HomeEntryVisibility = {},
  entries: HomeEntry[] = availableHomeEntries,
): HomeEntry[] {
  return orderedHomeEntries(category, undefined, entries).filter(
    (entry) => visibility[entry.id] !== false,
  );
}

export function homeCategoryHasVisibleEntries(
  category: HomeCategoryId,
  visibility: HomeEntryVisibility = {},
): boolean {
  return visibleHomeEntries(category, visibility).length > 0;
}

/** 由「上次使用的工具」找到对应入口；未在当前平台提供时返回 undefined。 */
export function getToolEntry(tool: ToolRoute): HomeEntry | undefined {
  const module = moduleForTool(tool);
  if (!module) return undefined;
  return availableHomeEntries.find((entry) => entry.id === module.id);
}
