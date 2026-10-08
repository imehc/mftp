import "@xterm/xterm/css/xterm.css";

import { msg } from "@lingui/core/macro";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { toast } from "sonner";

import { translate } from "~/i18n/translate";
import { describeError, frontendError, toIpcError } from "~/lib/errors";
import {
  createSubscription,
  disposeSubscriptions,
  type Subscription,
} from "~/lib/event-subscription";
import { sshClosedEvent, sshDataEvent } from "~/lib/events";
import * as ipc from "~/lib/ipc";
import { useSessionsStore } from "~/store/sessions";

/**
 * SSH 终端运行期。
 *
 * 终端原先由 `Terminal` 组件自建自毁：离开 SSH 页面（或路由重挂载）就把
 * xterm 实例连同滚回缓冲一起丢掉，而离开期间后端 shell 仍在输出，事件无人
 * 接收就直接丢失；回来后还会再调一次 `open_shell`，若 shell 已退出就会静默
 * 重开，前端无从分辨。
 *
 * 这里把 xterm 实例、数据/关闭订阅和尺寸跟随都收到运行期，按会话 id 持有：
 * 组件只负责把持久槽位搬进页面，卸载时搬回离屏宿主。会话被移除（关闭标签）
 * 时才真正释放。
 */

type OpeningListener = (opening: boolean) => void;

interface TerminalEntry {
  term: XTerm;
  fit: FitAddon;
  /** 持久槽位：挂载时搬进页面，卸载后搬回离屏宿主，xterm 实例不重建。 */
  slot: HTMLDivElement;
  /** 当前挂载点；为 null 表示不在页面上，此时不做 fit / resize。 */
  mountedAt: HTMLElement | null;
  observer: ResizeObserver;
  listeners: Set<OpeningListener>;
  subscriptions: Subscription[];
  onData: { dispose: () => void };
  opening: boolean;
  disposed: boolean;
}

// 编解码辅助函数，用于 shell 通道的 base64 传输。
const enc = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const entries = new Map<string, TerminalEntry>();
let unsubscribeSessions: (() => void) | null = null;
let offscreenHost: HTMLDivElement | null = null;

/** 不在页面上时的落点：留在文档里让 xterm 保持可测量，但不参与交互。 */
function hostEl(): HTMLDivElement {
  if (!offscreenHost) {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "position:fixed;top:0;left:-20000px;width:1024px;height:720px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(el);
    offscreenHost = el;
  }
  return offscreenHost;
}

function emitOpening(entry: TerminalEntry): void {
  for (const listener of entry.listeners) listener(entry.opening);
}

function setOpening(entry: TerminalEntry, opening: boolean): void {
  entry.opening = opening;
  emitOpening(entry);
}

function watchSessions(): void {
  if (unsubscribeSessions) return;
  unsubscribeSessions = useSessionsStore.subscribe((state) => {
    const alive = new Set(state.sessions.map((session) => session.id));
    for (const [id, entry] of entries) {
      if (!alive.has(id)) disposeEntry(id, entry);
    }
    if (entries.size === 0 && unsubscribeSessions) {
      unsubscribeSessions();
      unsubscribeSessions = null;
    }
  });
}

function disposeEntry(sessionId: string, entry: TerminalEntry): void {
  if (entry.disposed) return;
  entry.disposed = true;
  entries.delete(sessionId);
  entry.observer.disconnect();
  entry.onData.dispose();
  disposeSubscriptions(entry.subscriptions);
  entry.term.dispose();
  entry.slot.remove();
  entry.listeners.clear();
}

function handleResize(entry: TerminalEntry, sessionId: string): void {
  if (!entry.mountedAt || entry.disposed) return;
  try {
    entry.fit.fit();
    void ipc.sshResize(sessionId, entry.term.cols, entry.term.rows);
  } catch {
    /* 容器尚不可测量 */
  }
}

/** 订阅就绪后才打开 shell，注册完成前的初始输出不能丢。 */
function openShell(sessionId: string, entry: TerminalEntry): void {
  let shellOpenConfirmed = false;
  let subscriptionError: unknown = null;

  const onSubscriptionError = (cause: unknown) => {
    subscriptionError ??= cause;
  };

  // 后端 → 终端：解码 base64 负载并写入。
  const dataSubscription = createSubscription(
    () =>
      listen<string>(sshDataEvent(sessionId), (event) => {
        if (!entry.disposed) entry.term.write(base64ToBytes(event.payload));
      }),
    { onError: onSubscriptionError },
  );
  const closedSubscription = createSubscription(
    () =>
      listen<string>(sshClosedEvent(sessionId), () => {
        if (entry.disposed) return;
        entry.term.write(
          `\r\n\x1b[31m[${translate(msg`连接已关闭`)}]\x1b[0m\r\n`,
        );
        useSessionsStore.getState().patch(
          sessionId,
          shellOpenConfirmed
            ? { status: "closed" }
            : {
                status: "error",
                error: frontendError(
                  "frontend:shell_closed_before_open",
                  "Remote connection closed before the terminal opened",
                ),
              },
        );
      }),
    { onError: onSubscriptionError },
  );
  entry.subscriptions.push(dataSubscription, closedSubscription);

  setOpening(entry, true);
  void Promise.all([dataSubscription.ready, closedSubscription.ready]).then(
    () => {
      if (entry.disposed) return;
      if (subscriptionError) {
        // 监听没装上就不能打开终端，否则字节流无人接收。
        setOpening(entry, false);
        useSessionsStore.getState().patch(sessionId, {
          status: "error",
          error: toIpcError(subscriptionError).payload,
        });
        return;
      }
      // 按当前终端尺寸打开远程 shell。
      return ipc
        .sshOpenShell(sessionId, entry.term.cols, entry.term.rows)
        .then(() => {
          shellOpenConfirmed = true;
          if (entry.disposed) return;
          setOpening(entry, false);
          useSessionsStore.getState().patch(sessionId, { status: "connected" });
        })
        .catch((error) => {
          if (!entry.disposed) setOpening(entry, false);
          useSessionsStore.getState().patch(sessionId, {
            status: "error",
            error: toIpcError(error).payload,
          });
          const failure = describeError(error);
          toast.error(translate(msg`打开终端失败：${failure}`));
        });
    },
  );
}

function createEntry(sessionId: string): TerminalEntry | null {
  const session = useSessionsStore
    .getState()
    .sessions.find((candidate) => candidate.id === sessionId);
  // 草稿标签（后端会话 id 未就绪）与出错会话不建终端。
  if (!session || session.id.startsWith("tab-")) return null;
  if (session.status !== "connected" && session.status !== "connecting") {
    return null;
  }

  const slot = document.createElement("div");
  slot.style.cssText = "width:100%;height:100%;";
  // 先挂到离屏宿主：xterm 需要可测量的父节点来初始化字符尺寸。
  hostEl().appendChild(slot);
  const term = new XTerm({
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: {
      background: "#0a0a0a",
      foreground: "#e5e5e5",
    },
    scrollback: 10_000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(slot);

  const observer = new ResizeObserver(() => {
    handleResize(entry, sessionId);
  });
  const entry: TerminalEntry = {
    term,
    fit,
    slot,
    mountedAt: null,
    observer,
    listeners: new Set(),
    subscriptions: [],
    // 终端 → 后端：将按键以 base64 转发。
    onData: term.onData((data) => {
      void ipc.sshWrite(sessionId, bytesToBase64(enc.encode(data)));
    }),
    opening: false,
    disposed: false,
  };
  entries.set(sessionId, entry);
  watchSessions();
  openShell(sessionId, entry);
  return entry;
}

/**
 * 把会话的终端挂到 `container` 上。返回解除函数：只做「搬回离屏宿主」，
 * 不销毁实例，因此切页/重挂载后滚回缓冲与后续输出都还在。
 */
export function acquireTerminal(
  sessionId: string,
  container: HTMLElement,
  onOpening: OpeningListener,
): () => void {
  const entry = entries.get(sessionId) ?? createEntry(sessionId);
  if (!entry || entry.disposed) {
    onOpening(false);
    return () => undefined;
  }
  entry.listeners.add(onOpening);
  onOpening(entry.opening);
  entry.mountedAt = container;
  container.appendChild(entry.slot);
  entry.observer.observe(container);
  // 槽位刚搬进来，先量一次再让 ResizeObserver 接管后续变化。
  handleResize(entry, sessionId);
  try {
    entry.term.focus();
  } catch {
    /* 视图隐藏时不可聚焦 */
  }

  return () => {
    entry.listeners.delete(onOpening);
    if (entry.disposed) return;
    entry.observer.disconnect();
    entry.mountedAt = null;
    hostEl().appendChild(entry.slot);
  };
}
