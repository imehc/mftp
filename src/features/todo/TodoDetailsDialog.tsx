import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";

import type { TodoNoteDetails } from "~/bindings";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import { Spinner } from "~/components/ui/spinner";
import { describeError, toIpcError } from "~/lib/errors";
import { todoNoteDetails } from "~/lib/ipc";
import type { AppError, TodoItem } from "~/types";

import TodoNoteContent from "./notes/TodoNoteContent";
import TodoTimestamps from "./TodoTimestamps";

export default function TodoDetailsDialog({
  item,
  onClose,
}: {
  item: TodoItem | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    details: TodoNoteDetails | null;
    error: AppError | null;
  }>({ key: "", details: null, error: null });
  const id = item?.id;
  const key = JSON.stringify([id, item?.updatedAt, attempt]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    void todoNoteDetails(id).then(
      (details) => {
        if (active) setState({ key, details, error: null });
      },
      (error: unknown) => {
        if (active)
          setState({ key, details: null, error: toIpcError(error).payload });
      },
    );
    return () => {
      active = false;
    };
  }, [id, key]);
  const details = state.key === key ? state.details : null;
  const error = state.key === key ? state.error : null;
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogLayoutContent
        placement="responsive-page"
        className="ui-density-adaptive md:max-w-xl"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle>
            <Trans>待办详情</Trans>
          </DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4">
          {item ? (
            <>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.category ? (
                    <Badge
                      variant="outline"
                      className="h-auto min-h-5 max-w-full wrap-break-word whitespace-normal"
                    >
                      {item.category}
                    </Badge>
                  ) : null}
                  {item.abandoned ? (
                    <Badge variant="outline">
                      <Trans>已废弃</Trans>
                    </Badge>
                  ) : null}
                  {item.priority ? (
                    <Badge
                      variant={
                        item.priority === "high"
                          ? "destructive"
                          : item.priority === "medium"
                            ? "default"
                            : "secondary"
                      }
                    >
                      {item.priority === "high" ? (
                        <Trans>高</Trans>
                      ) : item.priority === "medium" ? (
                        <Trans>中</Trans>
                      ) : (
                        <Trans>低</Trans>
                      )}
                    </Badge>
                  ) : null}
                </div>
                <h3 className="text-base leading-6 font-medium wrap-break-word">
                  {item.title}
                </h3>
                <TodoTimestamps item={item} details />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{describeError(error, t)}</AlertDescription>
                  <Button
                    variant="outline"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    <Trans>重试</Trans>
                  </Button>
                </Alert>
              ) : !details ? (
                <div className="flex items-center gap-2 text-sm" role="status">
                  <Spinner />
                  <Trans>正在读取备注</Trans>
                </div>
              ) : details.document.blocks.length ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">
                    <Trans>备注</Trans>
                  </h3>
                  <TodoNoteContent
                    document={details.document}
                    itemId={item.id}
                  />
                </section>
              ) : null}
            </>
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter>
          <DialogClose asChild>
            <Button variant="outline" fullWidth>
              <Trans>关闭</Trans>
            </Button>
          </DialogClose>
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
