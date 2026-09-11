import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ToolPageHeader } from "~/components/ToolPageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  todoItemCreate,
  todoItemDelete,
  todoItemUpdate,
  todoItemsList,
} from "~/lib/ipc";
import type { TodoItem, TodoItemInput } from "~/types";
import TodoItemDialog from "./TodoItemDialog";
import TodoList from "./TodoList";
import {
  ALL_TODO_CATEGORIES,
  localDateKey,
  sortTodoItems,
  todoView,
  type TodoView,
} from "./todo-utils";

export default function TodoTool() {
  const { t } = useLingui();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState(ALL_TODO_CATEGORIES);
  const [view, setView] = useState<TodoView>("active");
  const [today, setToday] = useState(() => localDateKey(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [deleting, setDeleting] = useState<TodoItem | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    todoItemsList()
      .then((nextItems) => setItems(sortTodoItems(nextItems)))
      .catch((error) =>
        toast.error(t`读取待办失败`, { description: String(error) }),
      )
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    // 跨过午夜后重新计算逾期状态，避免应用长时间打开时列表不更新。
    const timer = window.setTimeout(
      () => setToday(localDateKey(new Date())),
      nextMidnight.getTime() - now.getTime() + 1_000,
    );
    return () => window.clearTimeout(timer);
  }, [today]);

  const categories = [
    ...new Set(items.flatMap((item) => (item.category ? [item.category] : []))),
  ].sort((left, right) => left.localeCompare(right));
  const itemsByView = {
    active: items.filter((item) => todoView(item, today) === "active"),
    overdue: items.filter((item) => todoView(item, today) === "overdue"),
    completed: items.filter((item) => todoView(item, today) === "completed"),
  } satisfies Record<TodoView, TodoItem[]>;
  const filteredItems =
    category === ALL_TODO_CATEGORIES
      ? itemsByView[view]
      : itemsByView[view].filter((item) => item.category === category);

  async function handleSubmit(input: TodoItemInput) {
    try {
      if (editing) {
        const updated = await todoItemUpdate(editing.id, input);
        setItems((current) =>
          sortTodoItems(
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
        );
      } else {
        const created = await todoItemCreate(input);
        setItems((current) => sortTodoItems([...current, created]));
      }
      setDialogOpen(false);
      setEditing(null);
      toast.success(t`已保存`);
    } catch (error) {
      toast.error(t`保存待办失败`, { description: String(error) });
    }
  }

  async function handleToggle(item: TodoItem) {
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      const updated = await todoItemUpdate(item.id, {
        title: item.title,
        category: item.category,
        notes: item.notes,
        dueDate: item.dueDate,
        completed: !item.completed,
      });
      setItems((current) =>
        sortTodoItems(
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        ),
      );
    } catch (error) {
      toast.error(t`更新待办失败`, { description: String(error) });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await todoItemDelete(deleting.id);
      setItems((current) => current.filter((item) => item.id !== deleting.id));
      toast.success(t`已删除`);
    } catch (error) {
      toast.error(t`删除待办失败`, { description: String(error) });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="bg-background text-foreground flex h-full flex-col">
      <ToolPageHeader
        title={<Trans>待办事项</Trans>}
        trailing={
          <Badge variant="outline">
            <Trans>本地</Trans>
          </Badge>
        }
      />

      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-2 p-2.5 sm:p-3">
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <Tabs
            value={view}
            onValueChange={(value) => setView(value as TodoView)}
            className="gap-0"
          >
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="active">
                <Trans>进行中</Trans>
                <Badge variant="outline">{itemsByView.active.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="overdue">
                <Trans>未完成</Trans>
                <Badge variant="outline">{itemsByView.overdue.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="completed">
                <Trans>已完成</Trans>
                <Badge variant="outline">{itemsByView.completed.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger
                className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label={t`分类`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TODO_CATEGORIES}>
                  <Trans>全部分类</Trans>
                </SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="secondary">{filteredItems.length}</Badge>
            <Button
              className="ml-auto"
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus data-icon="inline-start" />
              <Trans>新建</Trans>
            </Button>
          </div>
        </div>

        {loading ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                <Trans>正在读取待办</Trans>
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : filteredItems.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                <Trans>暂无待办</Trans>
              </EmptyTitle>
              <EmptyDescription>
                {items.length === 0 ? (
                  <Trans>点击“新建”添加第一条待办</Trans>
                ) : category !== ALL_TODO_CATEGORIES ? (
                  <Trans>当前分类没有待办</Trans>
                ) : view === "active" ? (
                  <Trans>没有进行中的待办</Trans>
                ) : view === "overdue" ? (
                  <Trans>没有逾期未完成的待办</Trans>
                ) : (
                  <Trans>还没有已完成的待办</Trans>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <TodoList
            items={filteredItems}
            pendingIds={pendingIds}
            onToggle={(item) => void handleToggle(item)}
            onEdit={(item) => {
              setEditing(item);
              setDialogOpen(true);
            }}
            onDelete={setDeleting}
          />
        )}
      </div>

      <TodoItemDialog
        open={dialogOpen}
        item={editing}
        categories={categories}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>删除待办？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>删除后无法恢复。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>取消</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              <Trans>删除</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
