import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

import type { ModuleId } from "~/lib/module-metadata";

/** 展示说明留在首页，不让领域元数据依赖 React 或文案。只补充标题没表达的能力，同义改写不占行。 */
export const homeDescriptions: Partial<Record<ModuleId, ReactNode>> = {
  "ssh-sftp": <Trans>终端与远端文件</Trans>,
  "lan-transfer": <Trans>局域网共享文件</Trans>,
  "media-compress": <Trans>压缩图片、视频与调整尺寸</Trans>,
  "model-viewer": (
    <Trans comment="首页 3D 模型工具说明，列出支持的文件格式。">
      查看 GLB · glTF · FBX 模型
    </Trans>
  ),
  formatter: <Trans>整理与校验文本</Trans>,
  bt: <Trans>磁力链接与种子下载</Trans>,
  library: <Trans>阅读、收藏与翻译</Trans>,
};
