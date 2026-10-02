import { Trans, useLingui } from "@lingui/react/macro";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel, FieldError } from "~/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "~/components/ui/select";
import { describeError } from "~/lib/errors";
import { useAiDelete } from "./hooks/use-ai-delete";
import type { AiDeleteTarget } from "./types";

export default function AiDeleteDialog({
  target,
  onClose,
}: {
  target: AiDeleteTarget;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const {
    busy,
    error,
    provider,
    stale,
    current,
    choices,
    replacement,
    setReplacement,
    remove,
    rebase,
  } = useAiDelete(target, onClose);
  const title =
    target.kind === "provider"
      ? t`删除服务地址？`
      : target.kind === "key"
        ? t`删除密钥？`
        : t`删除模型？`;
  const keyCount = target.provider.keys.length;
  const modelCount = target.provider.models.length;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent className="ui-density-adaptive">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {target.kind === "provider" ? (
              <Trans>
                将删除此地址及其 {keyCount} 个密钥和 {modelCount}{" "}
                个模型。删除当前地址后，不会自动启用其他地址。
              </Trans>
            ) : (
              <Trans>
                删除后无法撤销。删除当前项时，需要选择同地址下的替代项。
              </Trans>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="truncate text-sm font-medium">
          {target.kind === "provider"
            ? target.provider.name
            : target.kind === "key"
              ? target.item.label
              : target.item.modelId}
        </p>
        {current ? (
          <Field>
            <FieldLabel htmlFor="ai-replacement">
              <Trans>替代项</Trans>
            </FieldLabel>
            <Select
              value={replacement}
              onValueChange={setReplacement}
              disabled={busy}
            >
              <SelectTrigger id="ai-replacement" className="w-full">
                <SelectValue placeholder={t`请选择替代项`} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {choices.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {error ? (
          <FieldError role="alert">{describeError(error)}</FieldError>
        ) : null}
        {stale ? (
          <Button variant="outline" disabled={busy} onClick={rebase}>
            <Trans>使用最新版本重新确认</Trans>
          </Button>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            <Trans>取消</Trans>
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={
              busy ||
              stale ||
              !provider ||
              (current && !choices.some((item) => item.id === replacement))
            }
            onClick={() => void remove()}
          >
            <Trans>确认删除</Trans>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
