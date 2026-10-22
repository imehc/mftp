export interface BuildInfo {
  /** package.json 里的应用版本。 */
  appVersion: string;
  /** 应用实际链接的 tauri crate 版本。 */
  tauriVersion: string;
  /** 构建模式，Release 或 Debug。 */
  mode: string;
  buildNumber: string;
  buildDate: string;
  commit: string;
  /** 构建时使用的 Node 版本，不含前缀 `v`。 */
  node: string;
  /** 构建时使用的 rustc 版本。 */
  rustc: string;
  /** 构建时使用的 tauri-cli 版本。 */
  tauriCli: string;
}

/**
 * 构建信息由 Vite 在配置加载时注入，值是只读快照。
 * 浏览器预览、单测等没有注入的场景返回 null，由调用方降级成占位符。
 */
declare const __MFTP_BUILD_INFO__: BuildInfo | undefined;

export const buildInfo: BuildInfo | null =
  typeof __MFTP_BUILD_INFO__ === "undefined" ? null : __MFTP_BUILD_INFO__;
