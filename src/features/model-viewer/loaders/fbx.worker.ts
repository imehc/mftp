import { parseFbx } from "./fbx-parse";
import { fbxError } from "./fbx-policy";

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const result = parseFbx(event.data);
    self.postMessage({ result: result.value }, { transfer: result.buffers });
  } catch (error) {
    const payload =
      error && typeof error === "object" && "kind" in error
        ? error
        : fbxError("decode");
    self.postMessage({ error: payload });
  } finally {
    // 发送后主动结束；主线程也调用 terminate，释放解析器的模块级场景引用。
    self.close();
  }
};
