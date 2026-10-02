/**
 * 串行轮询原语。
 *
 * 后台读取常见两类错误：慢请求堆叠（每次定时器都新发一次请求）和
 * 「读取途中又收到触发」。这里保证同一时刻只有一次在途读取：在途期间的
 * 触发只做一次补跑，读取结束后再调度下一次。
 *
 * 页面不可见时暂停（`pauseWhenHidden`），恢复可见时立即补一次；
 * 长任务的终态由后端事件驱动，不依赖这里的轮询节奏。
 */
export interface Poller {
  /** 立即触发一次；在途读取则在其结束后补一次。 */
  trigger: () => void;
  /** 暂停/恢复轮询；恢复时会立即补一次。 */
  setActive: (active: boolean) => void;
  /** 幂等停止，清空定时器和可见性监听。 */
  stop: () => void;
}

export interface PollerOptions {
  intervalMs: number;
  /** 创建后是否立即运行一次，默认 true。 */
  runImmediately?: boolean;
  /** 任务抛出且未被内部处理时的兜底回调；轮询本身不会因此停止。 */
  onError?: (error: unknown) => void;
  /** 文档不可见时暂停轮询，恢复可见时补跑。 */
  pauseWhenHidden?: boolean;
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden;
}

export function createPoller(
  task: () => Promise<void>,
  options: PollerOptions,
): Poller {
  const {
    intervalMs,
    runImmediately = true,
    onError,
    pauseWhenHidden = false,
  } = options;
  let stopped = false;
  let active = !pauseWhenHidden || !isHidden();
  let inFlight = false;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delay: number): void {
    if (stopped || !active || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  }

  async function run(): Promise<void> {
    if (stopped || !active || inFlight) {
      if (inFlight) rerun = true;
      return;
    }
    inFlight = true;
    try {
      await task();
    } catch (error) {
      onError?.(error);
    }
    inFlight = false;
    if (rerun) {
      rerun = false;
      schedule(0);
    } else {
      schedule(intervalMs);
    }
  }

  function setActive(next: boolean): void {
    if (stopped || next === active) return;
    active = next;
    if (!active) {
      rerun = false;
      clearTimer();
      return;
    }
    if (inFlight) rerun = true;
    else schedule(0);
  }

  function onVisibilityChange(): void {
    setActive(!isHidden());
  }

  if (pauseWhenHidden) {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (runImmediately) schedule(0);

  return {
    trigger: () => {
      if (stopped || !active) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      schedule(0);
    },
    setActive,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimer();
      if (pauseWhenHidden) {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    },
  };
}
