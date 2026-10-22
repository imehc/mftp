import { describe, expect, it } from "vitest";

import type { McpModuleInfo } from "~/bindings";

import { filterTools, presentModules } from "./catalog-presentation";

const modules: McpModuleInfo[] = [
  {
    id: "todo",
    title: "Todo",
    tools: [
      {
        name: "todo_note_save",
        description: "Save document",
        permission: "write",
      },
      { name: "todo_get", description: "Read", permission: "read" },
    ],
  },
  {
    id: "sample",
    title: "示例模块",
    tools: [
      { name: "sample_read", description: "Read sample", permission: "read" },
    ],
  },
];

describe("MCP 工具展示与筛选", () => {
  it("模块用途走所属功能翻译且保留协议调用名", () => {
    const presented = presentModules(
      modules,
      (message) => message.message ?? message.id ?? "",
    );
    expect(presented[0].title).toBe("待办事项");
    expect(presented[0].tools[0].title).toBe("保存完整图文");
    expect(presented[0].tools[0].name).toBe("todo_note_save");
    expect(presented[1].tools[0].title).toBe("sample_read");
  });

  it("中文用途和调用名均可查询，模块间不混组", () => {
    const presented = presentModules(
      modules,
      (message) => message.message ?? message.id ?? "",
    );
    expect(filterTools(presented, "all", "完整图文")[0].tools).toHaveLength(2);
    expect(
      filterTools(presented, "all", "TODO_NOTE_SAVE")[0].tools,
    ).toHaveLength(1);
    expect(filterTools(presented, "sample", "todo")).toEqual([]);
  });
});
