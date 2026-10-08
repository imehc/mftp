import { analyzeTopology } from "./topology";
import type { AnalysisRequest } from "./types";

self.onmessage = async (event: MessageEvent<AnalysisRequest>) => {
  try {
    const request = event.data;
    if (request.kind === "topology") {
      self.postMessage({
        result: request.meshes.map((mesh) =>
          analyzeTopology(mesh, request.tolerance),
        ),
      });
    } else {
      const { validateBytes } = await import("gltf-validator");
      const report = await validateBytes(
        new Uint8Array(await request.source.entry.arrayBuffer()),
        {
          maxIssues: 200,
          writeTimestamp: false,
          externalResourceFunction: async (uri) => {
            // 只允许导入时已授权的依赖；验证器不获得 fetch 或磁盘回退入口。
            const blob = request.source.resources.get(uri);
            if (!blob) throw new Error("Resource not authorized");
            return new Uint8Array(await blob.arrayBuffer());
          },
        },
      );
      self.postMessage({ result: report });
    }
  } catch {
    self.postMessage({ error: true });
  }
};
