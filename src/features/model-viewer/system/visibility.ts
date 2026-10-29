export async function waitUntilVisible(signal: AbortSignal) {
  signal.throwIfAborted();
  if (!document.hidden) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("visibilitychange", visible);
      signal.removeEventListener("abort", abort);
    };

    const visible = () => {
      if (!document.hidden) {
        cleanup();
        resolve();
      }
    };

    const abort = () => {
      cleanup();
      reject(signal.reason);
    };

    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", abort, { once: true });
  });
}
