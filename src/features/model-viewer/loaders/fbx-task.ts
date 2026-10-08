import { IpcError } from "~/lib/errors";
import type { AppError } from "~/bindings";
import { FBX_PARSE_TIMEOUT, fbxError } from "./fbx-policy";
import type { FbxTransfer } from "./fbx-transfer";

export function parseFbxTask(
  bytes: ArrayBuffer,
  signal: AbortSignal,
): Promise<FbxTransfer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./fbx.worker.ts", import.meta.url), {
      type: "module",
    });
    let settled = false;

    const finish = (error?: unknown, value?: FbxTransfer) => {
      if (settled) return;
      settled = true;
      // terminate 先停止实际解析，再完成导入 promise；旧消息不能恢复已取消的模型。
      worker.terminate();
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve(value!);
    };

    const cancel = () => finish(signal.reason);
    const timeout = setTimeout(
      () => finish(new IpcError(fbxError("fbx_limit"))),
      FBX_PARSE_TIMEOUT,
    );
    worker.onmessage = (
      event: MessageEvent<{ result?: FbxTransfer; error?: AppError }>,
    ) => {
      if (event.data.error) finish(new IpcError(event.data.error));
      else if (event.data.result) finish(undefined, event.data.result);
      else finish(new IpcError(fbxError("decode")));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new IpcError(fbxError("decode")));
    };
    worker.onmessageerror = () => finish(new IpcError(fbxError("decode")));
    signal.addEventListener("abort", cancel, { once: true });
    try {
      worker.postMessage(bytes, [bytes]);
    } catch (error) {
      finish(error);
    }
  });
}
