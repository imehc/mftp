import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import TodoTool from "~/features/todo/TodoTool";
import { useSettingsStore } from "~/store/settings";

function TodoRoute() {
  const setLastTool = useSettingsStore((state) => state.setLastTool);

  useEffect(() => {
    setLastTool("todo");
  }, [setLastTool]);

  return <TodoTool />;
}

export const Route = createFileRoute("/tools/todo")({
  component: TodoRoute,
});
