import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { translate } from "~/i18n/translate";
import type { ActivityLog } from "~/types";

// 操作代码只用于查找；按来源区分同名操作，未知代码保留原文以兼容历史记录。
// lingui-set comment="活动日志中的操作名称，描述已发起的操作，不表示操作成功"
const actionMessages: Record<string, MessageDescriptor> = {
  "todo:create": msg`新增待办`,
  "todo:update": msg`更新待办`,
  "todo:delete": msg`删除待办`,
  "hosts:create": msg`新增主机`,
  "hosts:update": msg`更新主机`,
  "hosts:delete": msg`删除主机`,
  "hosts:reorder": msg`调整主机顺序`,
  "hosts:key_import": msg`导入 SSH 密钥`,
  "hosts:key_delete": msg`删除 SSH 密钥`,
  "vault:create": msg`新增密码条目`,
  "vault:update": msg`更新密码条目`,
  "vault:delete": msg`删除密码条目`,
  "vault:reorder": msg`调整密码条目顺序`,
  "ssh:connect": msg`连接主机`,
  "ssh:open_shell": msg`打开终端`,
  "ssh:disconnect": msg`断开连接`,
  "sftp:mkdir": msg`新建文件夹`,
  "sftp:rename": msg`重命名文件`,
  "sftp:delete": msg`删除文件`,
  "sftp:download": msg`下载文件`,
  "sftp:upload": msg`上传文件`,
  "sftp:upload_dir": msg`上传文件夹`,
  "sftp:download_dir": msg`下载文件夹`,
  "sftp:cancel_transfer": msg`取消传输`,
  "sftp:pause_transfer": msg`暂停传输`,
  "sftp:resume_transfer": msg`继续传输`,
  "sftp:reset_connection": msg`重置文件传输连接`,
  "sftp:extract": msg`解压文件`,
  "bt:add_download": msg`添加下载任务`,
  "bt:export": msg`导出下载文件`,
  "bt:control": msg`管理下载任务`,
  "data:export": msg`导出应用数据`,
  "data:import": msg`导入应用数据`,
  "games:create_room": msg`创建游戏房间`,
  "games:join_room": msg`加入游戏房间`,
  "games:leave_room": msg`离开游戏房间`,
  "poetry:sync": msg`同步诗词库`,
  "poetry:import": msg`导入诗词库`,
  "poetry:cancel": msg`取消诗词同步`,
  "poetry:delete_collection": msg`删除诗词集`,
  "poetry:build_index": msg`调整全文索引`,
  "poetry:install": msg`安装注释库`,
  "poetry:delete": msg`删除注释库`,
  "poetry:import_translation_pack": msg`导入译文包`,
  "poetry:delete_translation_pack": msg`删除译文包`,
  "lan:save_settings": msg`保存传输设置`,
  "lan:approve_auth": msg`批准访问申请`,
  "lan:reject_auth": msg`拒绝访问申请`,
  "lan:disconnect_device": msg`断开设备连接`,
  "lan:cancel_task": msg`取消传输任务`,
  "lan:start": msg`启动局域网传输`,
  "lan:stop": msg`停止局域网传输`,
  "lan:add_shared_dir": msg`添加共享目录`,
  "lan:delete_shared_dir": msg`删除共享目录`,
  "lan:add_trusted_device": msg`添加信任设备`,
  "lan:delete_trusted_device": msg`删除信任设备`,
  "lan:download": msg`下载文件`,
  "lan:upload": msg`上传文件`,
  "lan:download_head": msg`查看下载文件信息`,
  "lan:shares": msg`查看共享目录`,
  "lan:browse": msg`浏览共享文件`,
  "lan:request": msg`访问局域网服务`,
  "lan:authorize": msg`验证访问权限`,
  "lan:authorize_request": msg`申请访问权限`,
};
// lingui-reset

export function logAction(log: ActivityLog): string {
  const message = actionMessages[`${log.source}:${log.requestType}`];
  return message ? translate(message) : log.requestType;
}

// lingui-set comment="活动日志的对象类型；历史记录未保存名称时，与对象标识一起显示"
const hostObject = msg({
  context: "单个对象",
  comment: "活动日志中的单台主机，区别于导航里的主机列表",
  message: "主机",
});

function objectKind(log: ActivityLog): MessageDescriptor | null {
  switch (log.source) {
    case "todo":
      return msg`待办事项`;
    case "hosts":
      if (log.requestType.startsWith("key_")) return msg`SSH 密钥`;
      return log.requestType === "reorder" ? msg`主机列表` : hostObject;
    case "vault":
      return log.requestType === "reorder" ? msg`密码本` : msg`密码条目`;
    case "ssh":
      return log.requestType === "connect" ? hostObject : msg`SSH 会话`;
    case "sftp":
      return ["cancel_transfer", "pause_transfer", "resume_transfer"].includes(
        log.requestType,
      )
        ? msg`传输任务`
        : msg`SFTP 会话`;
    case "bt":
      return msg`BT 下载任务`;
    case "data":
      return msg`应用数据`;
    case "games":
      return msg`游戏房间`;
    case "poetry":
      if (log.requestType.includes("translation_pack")) return msg`译文包`;
      if (log.requestType === "delete_collection") return msg`诗词集`;
      if (log.requestType === "build_index") return msg`全文索引`;
      return msg`诗词库`;
    case "lan":
      switch (log.requestType) {
        case "save_settings":
          return msg`局域网传输设置`;
        case "approve_auth":
        case "reject_auth":
          return msg`访问申请`;
        case "cancel_task":
          return msg`传输任务`;
        case "add_shared_dir":
        case "delete_shared_dir":
          return msg`共享目录`;
        case "add_trusted_device":
        case "delete_trusted_device":
          return msg`信任设备`;
        case "start":
        case "stop":
          return msg`局域网传输服务`;
        default:
          return msg`访问设备`;
      }
    default:
      return null;
  }
}
// lingui-reset

const fileActions = new Set([
  "mkdir",
  "rename",
  "delete",
  "download",
  "upload",
  "upload_dir",
  "download_dir",
  "extract",
]);

// 只缩短明确的 UUID / BT 哈希；文件路径、IP 地址和普通名称保持完整。
function shortIdentifier(value: string): string {
  const opaque =
    /^(?:[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}|[\da-f]{40}|[\da-f]{64})$/i;
  return opaque.test(value) ? `${value.slice(0, 8)}…` : value;
}

export function logObject(log: ActivityLog): string {
  // 历史失败日志的 detail 可能是错误诊断，不能把它当作文件名或主机名。
  const detail = log.detail?.trim();
  const hasMetadata =
    log.error?.code !== "legacy:raw" && (log.result === "success" || log.error);
  if (
    detail &&
    hasMetadata &&
    log.source === "sftp" &&
    fileActions.has(log.requestType)
  ) {
    return detail;
  }
  if (
    detail &&
    hasMetadata &&
    log.source === "ssh" &&
    log.requestType === "connect"
  ) {
    return log.ip ? `${detail} · ${log.ip}` : detail;
  }

  if (log.source === "poetry" && log.ip === "annotations") {
    return translate(
      msg({
        comment: "活动日志对象：诗词的本地注释与赏析数据",
        message: "诗词注释库",
      }),
    );
  }
  if (log.source === "games" && log.requestType === "create_room") {
    const game = log.ip.replace(/\/online-v\d+$/, "");
    if (game === "gomoku") return translate(msg`五子棋房间`);
    if (game === "xiangqi") return translate(msg`中国象棋房间`);
  }

  const kind = objectKind(log);
  if (!kind) return log.ip || "—";
  const label = translate(kind);
  return log.ip ? `${label} · ${shortIdentifier(log.ip)}` : label;
}
