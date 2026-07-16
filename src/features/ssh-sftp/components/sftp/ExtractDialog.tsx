import type { Dispatch, SetStateAction } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import type { ExtractState } from "~/features/ssh-sftp/components/sftp/SftpPanel.utils";

interface ExtractDialogProps {
  extractTarget: ExtractState;
  directoryPickerOpen: boolean;
  setExtractTarget: Dispatch<SetStateAction<ExtractState>>;
  chooseExtractParent: () => void;
  confirmExtract: () => void;
}

export default function ExtractDialog({
  extractTarget,
  directoryPickerOpen,
  setExtractTarget,
  chooseExtractParent,
  confirmExtract,
}: ExtractDialogProps) {
  return (
    <Dialog
      open={!!extractTarget && !directoryPickerOpen}
      onOpenChange={(open) => !open && !directoryPickerOpen && setExtractTarget(null)}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>解压</DialogTitle>
          <DialogDescription className="truncate">
            {extractTarget?.entry.name ?? ""}
          </DialogDescription>
        </DialogHeader>
        {extractTarget ? (
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel>文件夹名称</FieldLabel>
              <Input
                value={extractTarget.outName}
                onChange={(event) =>
                  setExtractTarget((current) =>
                    current ? { ...current, outName: event.target.value } : current,
                  )
                }
              />
            </Field>
            <Field>
              <FieldLabel>位置</FieldLabel>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
                  {extractTarget.remoteParent}
                </div>
                <Button type="button" variant="outline" onClick={chooseExtractParent}>
                  <FolderOpen data-icon="inline-start" /> 选择
                </Button>
              </div>
            </Field>
          </FieldGroup>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setExtractTarget(null)}>
            取消
          </Button>
          <Button onClick={confirmExtract}>解压</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
