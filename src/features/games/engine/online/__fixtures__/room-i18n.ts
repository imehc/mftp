import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

// session 在房间结束与注册失败路径上会渲染这条文案；测试必须提供编译后的词条，
// 否则 lingui 在缺少消息时直接抛错。文案与 session.ts 中的源文一致。
const roomClosed = msg`游戏房间连接已结束，请重新加入`;

export function installRoomMessages() {
  i18n.load("zh-CN", { [roomClosed.id]: ["游戏房间连接已结束，请重新加入"] });
  i18n.load("en", {
    [roomClosed.id]: ["The game room connection has ended. Please rejoin."],
  });
  i18n.activate("zh-CN");
}
