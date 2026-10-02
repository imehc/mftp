export const TEXT_HEAD_BYTES = 128 * 1024;
export interface TextPreview {
  body: string;
  truncated: boolean;
  interrupted: boolean;
}

export async function readTextPreview(
  url: string,
  signal: AbortSignal,
  onChunk: (text: TextPreview) => void,
): Promise<TextPreview> {
  let body = "",
    received = 0;
  try {
    const response = await fetch(url, {
      signal,
      cache: "no-store",
      headers: { Range: `bytes=0-${TEXT_HEAD_BYTES - 1}` },
    });
    if (!response.ok)
      throw new Error(`Preview response: HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Preview response has no body");
    const decoder = new TextDecoder();
    try {
      // 即使服务端忽略 Range，也限制实际保留字节；分块解码避免截断 UTF-8 字符。
      while (received < TEXT_HEAD_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = value.subarray(0, TEXT_HEAD_BYTES - received);
        received += chunk.byteLength;
        body += decoder.decode(chunk, { stream: true });
        signal.throwIfAborted();
        onChunk({ body, truncated: false, interrupted: false });
      }
      body += decoder.decode();
    } finally {
      // 读取失败时仍释放流；原始错误由外层处理，取消失败不覆盖原始诊断。
      await reader.cancel().catch(() => undefined);
    }
    signal.throwIfAborted();
    const total = Number(
      response.headers.get("Content-Range")?.split("/")[1] ??
        response.headers.get("Content-Length"),
    );
    return {
      body,
      truncated: total > received || received >= TEXT_HEAD_BYTES,
      interrupted: false,
    };
  } catch (error) {
    if (signal.aborted || !received) throw error;
    return { body, truncated: true, interrupted: true };
  }
}
