import { useLingui } from "@lingui/react/macro";
import { MoreHorizontal } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";

import type { SftpAction } from "./sftp-actions";

export default function SftpActionsMobile({
  name,
  open,
  onOpenChange,
  actions,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: SftpAction[];
}) {
  const { t } = useLingui();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t`更多文件操作`}>
          <MoreHorizontal />
        </Button>
      </DialogTrigger>
      <DialogLayoutContent
        placement="responsive-sheet"
        className="ui-density-adaptive"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogLayoutHeader showCloseButton>
          <DialogTitle className="truncate">{name}</DialogTitle>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-1">
          {actions.map(({ label, icon: Icon, run, destructive }) => (
            <Button
              key={label}
              fullWidth
              variant="ghost"
              className={
                destructive
                  ? "text-destructive mt-2 justify-start border-t"
                  : "justify-start"
              }
              onClick={() => {
                onOpenChange(false);
                run();
              }}
            >
              <Icon />
              {label}
            </Button>
          ))}
        </DialogLayoutBody>
      </DialogLayoutContent>
    </Dialog>
  );
}
