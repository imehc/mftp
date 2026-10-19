import { toIpcError } from "~/lib/errors";

// 模型下载/安装类错误由模型管理弹窗就地展示，翻译页面不再重复提示。
export function isModelManagementError(error: unknown) {
  const code = toIpcError(error).payload.code;
  return (
    code.startsWith("http:") ||
    code === "translation:checksum" ||
    code === "translation:download" ||
    code === "translation:download_range" ||
    code === "translation:resource_invalid" ||
    code === "translation:space"
  );
}
