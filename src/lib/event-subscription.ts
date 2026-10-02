/**
 * Tauri 事件订阅的公共原语。
 *
 * `listen()` 的解除函数是异步返回的：注册可能在调用方已经取消（组件卸载、
 * 服务停止）之后才完成，也可能同步抛错或以 Promise 拒绝结束。直接
 * `void listen(...).then(...)` 会在这些时序下泄漏监听或留下未处理的 Promise。
 * 这里把「注册 — 就绪 — 释放」三种状态收口成一个句柄，调用方只需 `dispose()`。
 */
export interface Subscription {
  /** 注册尝试结束（成功或失败）后兑现，永不拒绝。 */
  ready: Promise<void>;
  /** 幂等；无论注册是否已经完成，最终都不会留下监听。 */
  dispose: () => void;
}

export interface SubscriptionOptions {
  /** 注册失败时回调；调用方决定是否重试或展示诊断。 */
  onError?: (error: unknown) => void;
}

type Disposer = () => void;

/** 释放 Tauri 解除函数：同步抛错和异步拒绝都不能变成未处理异常。 */
function release(dispose: Disposer): void {
  try {
    const result: unknown = dispose();
    // 声明返回 void，但运行时可能返回 Promise。
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void (result as PromiseLike<unknown>).then(undefined, () => undefined);
    }
  } catch {
    // 单个释放失败不影响其他清理。
  }
}

export function createSubscription(
  register: () => Promise<Disposer>,
  options: SubscriptionOptions = {},
): Subscription {
  let disposed = false;
  let unlisten: Disposer | null = null;
  let settleReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    settleReady = resolve;
  });

  const adopt = (dispose: Disposer) => {
    if (disposed) {
      // 注册在释放之后才完成：立刻解除，不能留下监听。
      release(dispose);
      return;
    }
    unlisten = dispose;
  };

  try {
    register().then(
      (dispose) => {
        adopt(dispose);
        settleReady();
      },
      (error: unknown) => {
        if (!disposed) options.onError?.(error);
        settleReady();
      },
    );
  } catch (error) {
    if (!disposed) options.onError?.(error);
    settleReady();
  }

  return {
    ready,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (unlisten) {
        release(unlisten);
        unlisten = null;
      }
    },
  };
}

/** 顺序释放一组订阅；单个失败不能中断其余清理。 */
export function disposeSubscriptions(
  subscriptions: readonly Subscription[],
): void {
  for (const subscription of subscriptions) {
    // `createSubscription` 的 dispose 自身不抛，但这里接收任意实现；
    // 一个释放失败不能连累后面还没释放的订阅。
    try {
      subscription.dispose();
    } catch {
      // 忽略：继续释放其余订阅。
    }
  }
}
