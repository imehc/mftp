import { createFileRoute } from "@tanstack/react-router";

import { useRememberTool } from "~/features/navigation/use-remember-tool";
import TodoTool from "~/features/todo/TodoTool";

function TodoRoute() {
  useRememberTool("todo");

  return <TodoTool />;
}

export const Route = createFileRoute("/tools/todo")({
  component: TodoRoute,
});
