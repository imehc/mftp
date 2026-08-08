import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";

/**
 * Display copy for the rule catalog, keyed by the Rust rule id.
 *
 * The backend's `CleanRule.externalHint` holds a key like `"hint.trash"`, but
 * this project's Lingui setup uses source strings as msgids, so those keys
 * cannot be resolved at runtime. The hint text lives here instead; the backend
 * field only signals that a hint exists.
 */
interface RuleMeta {
  label: ReactNode;
  /** Where to do it by hand. Set for every `manual` rule. */
  hint?: ReactNode;
}

export const ruleMeta: Record<string, RuleMeta> = {
  "frontend-build-cache": { label: <Trans>前端构建缓存</Trans> },
  "xcode-derived-data": { label: <Trans>Xcode 派生数据</Trans> },
  "homebrew-cache": { label: <Trans>Homebrew 缓存</Trans> },
  "user-logs": { label: <Trans>用户日志</Trans> },
  "npm-cache": { label: <Trans>npm 缓存</Trans> },
  "pnpm-store": { label: <Trans>pnpm 存储</Trans> },
  "cargo-registry-cache": { label: <Trans>Cargo registry 缓存</Trans> },
  "go-module-cache": { label: <Trans>Go 模块缓存</Trans> },
  "gradle-cache": { label: <Trans>Gradle 缓存</Trans> },
  "xcode-device-support": { label: <Trans>Xcode 设备支持</Trans> },
  trash: {
    label: <Trans>废纸篓</Trans>,
    hint: <Trans>在 Finder 中清空</Trans>,
  },
  "ios-simulator-runtime": {
    label: <Trans>iOS 模拟器运行时</Trans>,
    hint: <Trans>用 Xcode &gt; Settings &gt; Platforms 删除</Trans>,
  },
  "wechat-data": {
    label: <Trans>微信数据</Trans>,
    hint: <Trans>在微信设置中清理</Trans>,
  },
  "parallels-vm": {
    label: <Trans>Parallels 虚拟机</Trans>,
    hint: <Trans>在 Parallels 控制中心删除</Trans>,
  },
  "docker-data": {
    label: <Trans>Docker 数据</Trans>,
    hint: <Trans>用 docker system prune 清理</Trans>,
  },
};

/** Falls back to the raw id so an unmapped new rule still renders. */
export function ruleLabel(id: string): ReactNode {
  return ruleMeta[id]?.label ?? id;
}
