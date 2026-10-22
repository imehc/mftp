import type { MessageDescriptor } from "@lingui/core";

import type { McpModuleInfo } from "~/bindings";
import { todoMcpPresentation } from "~/features/todo/mcp-presentation";

interface ModulePresentation {
  title: MessageDescriptor;
  tools: Record<string, MessageDescriptor>;
}

const presentations: Record<string, ModulePresentation> = {
  todo: todoMcpPresentation,
};

export function presentModules(
  modules: McpModuleInfo[],
  translate: (message: MessageDescriptor) => string,
) {
  return modules.map((module) => {
    const presentation = presentations[module.id];
    return {
      ...module,
      title: presentation ? translate(presentation.title) : module.title,
      tools: module.tools.map((tool) => ({
        ...tool,
        title: presentation?.tools[tool.name]
          ? translate(presentation.tools[tool.name])
          : tool.name,
      })),
    };
  });
}

export type PresentedModule = ReturnType<typeof presentModules>[number];

export function filterTools(
  modules: PresentedModule[],
  moduleId: string,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return modules
    .filter((module) => moduleId === "all" || module.id === moduleId)
    .map((module) => ({
      ...module,
      tools: module.tools.filter(
        (tool) =>
          !needle ||
          `${module.title} ${tool.title} ${tool.name}`
            .toLocaleLowerCase()
            .includes(needle),
      ),
    }))
    .filter((module) => module.tools.length > 0);
}
