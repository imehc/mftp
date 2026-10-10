/** 仅调度调用方指定的下一次尝试，不自动重放异步任务。 */
export function createBackoffScheduler(
  retry: () => void,
  { baseMs, maxMs }: { baseMs: number; maxMs: number },
) {
  let delay = baseMs;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  return {
    schedule(): void {
      if (stopped) return;
      clear();
      timer = setTimeout(
        () => {
          timer = null;
          retry();
        },
        Math.min(delay, maxMs),
      );
      delay = Math.min(delay * 2, maxMs);
    },
    reset(): void {
      clear();
      delay = baseMs;
    },
    stop(): void {
      stopped = true;
      clear();
    },
  };
}
