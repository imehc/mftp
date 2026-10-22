import { describe, expect, it } from "vitest";

import { connectionConfig } from "./connection-config";

describe("MCP 客户端连接配置", () => {
  it("普通配置使用占位符且一次性配置才带凭据", () => {
    const endpoint = "http://127.0.0.1:6021/mcp";
    expect(JSON.parse(connectionConfig(endpoint)).mcpServers.mftp).toEqual({
      url: endpoint,
      headers: { Authorization: "Bearer <YOUR_TOKEN>" },
    });
    expect(
      JSON.parse(connectionConfig(endpoint, "test-secret")).mcpServers.mftp
        .headers.Authorization,
    ).toBe("Bearer test-secret");
  });
});
