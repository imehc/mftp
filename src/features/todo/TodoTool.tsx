import { Trans, useLingui } from "@lingui/react/macro";
import { Plus, Search } from "lucide-react";

import AppPageLayout from "~/components/AppPageLayout";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
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
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { describeError } from "~/lib/errors";
import { useDesktopLayout } from "~/lib/use-desktop-layout";

import { useTodo } from "./hooks/use-todo";
import { ALL_TODO_CATEGORIES, type TodoView } from "./todo-utils";
import TodoItemDialog from "./TodoItemDialog";
import TodoList from "./TodoList";

export default function TodoTool() {
  const { t } = useLingui();
  const desktopActions = useDesktopLayout();
  const {
    items,
    loading,
    loadError,
    retry,
    query,
    setQuery,
    category,
    setCategory,
    view,
    setView,
    categories,
    itemsByView,
    filteredItems,
    dialogOpen,
    setDialogOpen,
    editing,
    setEditing,
    deleting,
    setDeleting,
    pendingIds,
    handleSubmit,
    handleToggle,
    handleDelete,
  } = useTodo();

  return (
    <AppPageLayout
      title={<Trans>待办事项</Trans>}
      adaptiveDensity
      scroll="content"
      bottomInset={
        !loading && !loadError && filteredItems.length > 0 ? "scroll" : "page"
      }
      contentClassName="gap-1 pt-1 md:gap-3 md:pt-4"
      actions={
        <Button
          variant={desktopActions ? "default" : "ghost"}
          size={desktopActions ? "default" : "icon"}
          aria-label={t`新建待办`}
          title={t`新建待办`}
          disabled={loading}
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus data-icon={desktopActions ? "inline-start" : undefined} />
          {desktopActions ? <Trans>新建</Trans> : null}
        </Button>
      }
    >
      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t`搜索待办`}
          aria-label={t`搜索待办`}
          className="pl-9"
        />
      </div>
      <div className="flex shrink-0 flex-col md:flex-row md:items-center md:gap-2">
        <Tabs
          value={view}
          onValueChange={(value) => setView(value as TodoView)}
          className="gap-0"
        >
          <TabsList
            density="adaptive"
            aria-label={t({
              message: "待办状态",
              comment: "切换进行中、逾期和已完成待办的标签栏",
            })}
            className="w-full md:w-auto"
          >
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
        <div className="flex min-w-0 items-center gap-2 md:ml-auto">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger
              density="adaptive"
              className="min-w-0 flex-1 md:w-40 md:flex-none"
              aria-label={t`分类`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="ui-density-adaptive">
              <SelectGroup>
                <SelectItem value={ALL_TODO_CATEGORIES}>
                  <Trans>全部分类</Trans>
                </SelectItem>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Badge variant="secondary">{filteredItems.length}</Badge>
        </div>
      </div>

      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>
            <Trans>读取待办失败</Trans>
          </AlertTitle>
          <AlertDescription>{describeError(loadError)}</AlertDescription>
          <Button
            fullWidth
            variant="outline"
            onClick={retry}
            className="mt-2 justify-self-start"
          >
            <Trans comment="待办列表读取失败后重新加载">重试</Trans>
          </Button>
        </Alert>
      ) : loading ? (
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
              {query.trim() ? (
                <Trans>没有找到相关待办</Trans>
              ) : (
                <Trans>暂无待办</Trans>
              )}
            </EmptyTitle>
            <EmptyDescription>
              {query.trim() ? (
                <Trans>试试其他关键词或清除筛选</Trans>
              ) : items.length === 0 ? (
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
        <AlertDialogContent className="ui-density-adaptive">
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
    </AppPageLayout>
  );
}
