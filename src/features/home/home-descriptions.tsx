import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type { ModuleId } from "~/lib/module-metadata";

/** 展示说明留在首页，不让领域元数据依赖 React 或文案。 */
export const homeDescriptions: Record<ModuleId, ReactNode> = {
  "ssh-sftp": <Trans>连接主机，管理远端文件</Trans>,
  "lan-transfer": <Trans>在局域网共享文件</Trans>,
  crypto: <Trans>本地编码与解码</Trans>,
  "media-compress": <Trans>压缩图片、视频与调整尺寸</Trans>,
  "model-viewer": <Trans>在本地查看 GLB 与 glTF 三维模型</Trans>,
  formatter: <Trans>整理与校验文本数据</Trans>,
  vault: <Trans>管理账号与密码</Trans>,
  todo: <Trans>记录任务与清单</Trans>,
  bt: <Trans>磁力链接与种子下载</Trans>,
  library: <Trans>阅读、收藏与翻译古诗词</Trans>,
  billiards: <Trans>练习击球或开始对局</Trans>,
  gomoku: <Trans>落子连五，切磋棋艺</Trans>,
  go: <Trans>围地对弈，探索棋局</Trans>,
  xiangqi: <Trans>楚河汉界，布局对弈</Trans>,
};
