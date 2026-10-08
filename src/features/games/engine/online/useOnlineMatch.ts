/**
 * 联机对局的 React 侧收口：把共享对局控制器绑定到页面，映射协商
 * 快照到既有对话框与视图 props。走法时序、悔棋/重赛响应匹配与输入
 * 锁全部由 OnlineMatchController 处理，页面只提供游戏规则定义与音效。
 */
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { OnlineMatchController } from "./matchController";
import type { OnlineGame, OnlineTransport, Presentation } from "./matchTypes";
import type { UndoFlow } from "./OnlineMatchDialogs";

export function useOnlineMatch<S, M, P>(
  transport: OnlineTransport<M>,
  definition: OnlineGame<S, M, P>,
  presentation: Presentation<S, P>,
) {
  const { t } = useLingui();
  // 音效通过最新闭包读取音量等变化；ref 转发避免重建对局控制器。
  const presentationRef = useRef(presentation);
  useEffect(() => {
    presentationRef.current = presentation;
  });

  const attachPresentation = (controller: OnlineMatchController<S, M, P>) => {
    controller.onPresentation = (resolution) =>
      presentationRef.current(resolution);
  };

  const [entry, setEntry] = useState(() => {
    const controller = new OnlineMatchController(transport, definition);
    attachPresentation(controller);
    return { transport, controller };
  });
  // 会话（房间代次）更换时才重建控制器；重赛在控制器内部换 runner。
  if (entry.transport !== transport) {
    const controller = new OnlineMatchController(transport, definition);
    attachPresentation(controller);
    setEntry({ transport, controller });
  }
  const { controller } = entry;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => controller.retain(), [controller]);
  const noticedRef = useRef(0);
  useEffect(() => {
    const notice = snapshot.notice;
    if (!notice || notice.id === noticedRef.current) return;
    noticedRef.current = notice.id;
    toast(notice.kind === "undo" ? t`对方拒绝了悔棋` : t`对方拒绝了再来一局`);
  }, [snapshot.notice, t]);
  const pending = snapshot.pending;
  const incoming = pending?.direction === "incoming" ? pending.request : null;
  const outgoing = pending?.direction === "outgoing" ? pending.request : null;
  const undoFlow: UndoFlow =
    incoming?.t === "undo-request"
      ? { kind: "incoming", atMove: incoming.atMove, plies: incoming.plies }
      : outgoing?.t === "undo-request"
        ? { kind: "waiting" }
        : null;
  const endReason =
    snapshot.end === null
      ? null
      : snapshot.end === "desync"
        ? t`双方棋局状态不一致，本局无法继续。`
        : snapshot.end === "send-failed"
          ? t`消息发送失败，连接可能已断开。`
          : snapshot.end === "peer-left"
            ? t`对方已离开房间。`
            : snapshot.end === "connection-lost"
              ? t`与对方的连接已断开。`
              : t`对方长时间未回应协商，对局已结束。`;
  return {
    controller,
    snapshot,
    undoFlow,
    endReason,
    rematchWaiting: outgoing?.t === "rematch-request",
    rematchIncoming: incoming?.t === "rematch-request",
  };
}
