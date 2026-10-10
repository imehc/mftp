/** 取消只发出停止请求；必须等转换任务退出，不能用 Promise.race 提前释放忙碌状态。 */
export async function awaitConversion<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  cancel: () => void,
): Promise<T> {
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  try {
    const value = await operation;
    if (signal?.aborted)
      throw new DOMException("Conversion cancelled", "AbortError");
    return value;
  } catch (error) {
    if (signal?.aborted)
      throw new DOMException("Conversion cancelled", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
