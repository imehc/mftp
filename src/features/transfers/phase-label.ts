import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translate } from "~/i18n/translate";

// 兼容 SSH 后端已有的阶段值；只翻译应用阶段，不翻译协议返回的原文。
// lingui-set comment="SSH/SFTP 传输操作当前阶段"
const phases: Record<string, MessageDescriptor> = {
  扫描文件中: msg`扫描文件中`,
  扫描中: msg`扫描中`,
  压缩中: msg`压缩中`,
  下载压缩包中: msg`下载压缩包中`,
  上传压缩包中: msg`上传压缩包中`,
  本地解压中: msg`本地解压中`,
  远端解压中: msg`远端解压中`,
  远端删除中: msg`远端删除中`,
  确认远端解压结果: msg`确认远端解压结果`,
  创建目录中: msg`创建目录中`,
  下载文件夹中: msg`下载文件夹中`,
  上传文件夹中: msg`上传文件夹中`,
  下载中: msg`下载中`,
  上传中: msg`上传中`,
  完成: msg`完成`,
  重连后重新下载压缩包: msg`重连后重新下载压缩包`,
  重连后继续下载: msg`重连后继续下载`,
};
// lingui-reset

export function transferPhaseLabel(
  phase: string,
  localize = translate,
): string {
  const message = phases[phase];
  if (message) return localize(message);
  const retry = /^网络波动，正在续传（(\d+)\/(\d+)）$/.exec(phase);
  if (retry) {
    const [, attempt, limit] = retry;
    return localize(
      msg({
        message: `网络波动，正在续传（${attempt}/${limit}）`,
        comment: "SFTP 已有续传流程，attempt 为当前次数，limit 为上限",
      }),
    );
  }
  return phase;
}
