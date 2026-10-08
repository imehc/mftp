/**
 * 模块清单：首页入口、平台能力与「上次使用的工具」恢复的唯一来源。
 *
 * 之前 `TOOL_ROUTES`（settings store）和首页入口各自维护一份 ID 清单，
 * 新增入口要改多处且容易漏。这里只描述稳定 ID／平台／是否可恢复，
 * 图标与页面组合仍留在 UI 层，标题仍走 Lingui。
 */
export type ModulePlatform = "desktop" | "android" | "ios" | "mobile";

export interface ModuleMetadata {
  /** 稳定模块 id：与文件路由、首页入口 id 一致。 */
  id: string;
  /** 参与「上次使用的工具」恢复的路由 id；纯游戏等入口为 null。 */
  tool: string | null;
  /** 可用平台；省略表示全平台。 */
  platforms?: readonly ModulePlatform[];
}

export const modules = [
  { id: "ssh-sftp", tool: "ssh-sftp" },
  { id: "lan-transfer", tool: "lan-transfer", platforms: ["desktop"] },
  { id: "crypto", tool: "crypto" },
  { id: "media-compress", tool: "media-compress" },
  { id: "model-viewer", tool: "model-viewer" },
  { id: "formatter", tool: "formatter" },
  { id: "vault", tool: "vault" },
  { id: "todo", tool: "todo" },
  // iOS 不注册 BT 引擎；桌面端和 Android 使用独立本地 Session。
  { id: "bt", tool: "bt", platforms: ["desktop", "android"] },
  { id: "library", tool: "library" },
  { id: "billiards", tool: null },
  { id: "gomoku", tool: null },
  { id: "go", tool: null },
  { id: "xiangqi", tool: null },
] as const satisfies readonly ModuleMetadata[];

export type ModuleId = (typeof modules)[number]["id"];

/** 可恢复工具路由；类型从清单推导，声明了 `tool` 的条目才会出现在这里。 */
export type ToolRoute = Extract<
  (typeof modules)[number],
  { tool: string }
>["tool"];

export const TOOL_ROUTES: readonly ToolRoute[] = modules
  .map((entry) => entry.tool)
  .filter((tool): tool is ToolRoute => tool !== null);

export function moduleMetadata(id: string): ModuleMetadata | undefined {
  return modules.find((entry) => entry.id === id);
}

export function moduleForTool(tool: string): ModuleMetadata | undefined {
  return modules.find((entry) => entry.tool === tool);
}

/**
 * 入口 id → 可恢复工具路由。
 *
 * `tool` 字段声明为 `string | null` 以便清单用 `satisfies` 校验，取值域由
 * 上面的常量元组保证与 `ToolRoute` 同源，这里只做收窄。
 */
export function toolRouteOf(id: ModuleId): ToolRoute | null {
  return (moduleMetadata(id)?.tool ?? null) as ToolRoute | null;
}

/** 模块在当前平台是否可用；未登记平台的模块视为全平台。 */
export function moduleAvailableOn(
  module: ModuleMetadata,
  platform: ModulePlatform,
): boolean {
  return !module.platforms || module.platforms.includes(platform);
}
