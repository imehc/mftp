import { arch, locale, type, version } from "@tauri-apps/plugin-os";

export interface EnvironmentInfo {
  /** 展示用系统名与版本，例如 `macOS 14.5`。 */
  system: string;
  arch: string;
  locale: string | null;
}

const SYSTEM_LABELS: Record<string, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

/**
 * os 插件未注册（浏览器预览、旧产物）时，同步取值会因缺少注入脚本抛错，
 * 异步取值会直接 reject。整段兜底为 null，由关于页降级成占位符，
 * 不让环境信息影响页面的存储与运行状态。
 */
export async function readEnvironment(): Promise<EnvironmentInfo | null> {
  try {
    const name = SYSTEM_LABELS[type()] ?? type();
    const osVersion = version();
    const region = await locale().catch(() => null);
    return {
      system: osVersion ? `${name} ${osVersion}` : name,
      arch: arch(),
      locale: region,
    };
  } catch {
    return null;
  }
}
