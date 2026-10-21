import { commands } from "~/bindings";

// ---- 用户选中路径的运行时授权 ----
/** 让 fs 插件在本次会话内放行一个由原生对话框选中的路径。 */
export const filesystemAllowPath = (path: string) =>
  commands.filesystemAllowPath(path);
