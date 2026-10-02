import { Trans } from "@lingui/react/macro";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog, DialogClose, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import type { TodoItem } from "~/types";
import TodoTimestamps from "./TodoTimestamps";

export default function TodoDetailsDialog({
  item,
  onClose,
}: {
  item: TodoItem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogLayoutContent
        className="ui-density-adaptive md:max-w-lg"
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
                {item.category ? (
                  <Badge
                    variant="outline"
                    className="h-auto min-h-5 max-w-full break-words whitespace-normal"
                  >
                    {item.category}
                  </Badge>
                ) : null}
                <h3 className="text-base leading-6 font-medium break-words">
                  {item.title}
                </h3>
                <TodoTimestamps item={item} details />
              </div>
              {item.notes ? (
                <section className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-medium">
                    <Trans>备注</Trans>
                  </h3>
                  <p className="text-muted-foreground text-sm break-words whitespace-pre-wrap">
                    {item.notes}
                  </p>
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
