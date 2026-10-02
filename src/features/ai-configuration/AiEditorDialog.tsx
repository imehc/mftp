import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Dialog, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutContent,
  DialogLayoutHeader,
  DialogLayoutBody,
  DialogLayoutFooter,
} from "~/components/ui/dialog-layout";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "~/components/ui/alert-dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import CandidateInput from "~/components/CandidateInput";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { describeError } from "~/lib/errors";
import { useAiConfiguration } from "./store";
import { useAiEditor } from "./hooks/use-ai-editor";
import type { AiEditorTarget } from "./types";

export default function AiEditorDialog({
  target,
  onClose,
  onSaved,
  onLocate,
}: {
  target: AiEditorTarget;
  onClose: () => void;
  onSaved: () => void;
  onLocate: (target: AiEditorTarget) => void;
}) {
  const { t } = useLingui();
  const view = useAiConfiguration((state) => state.view)!;
  const busy = useAiConfiguration((state) => state.busy);
  const { bindSecret, ...form } = useAiEditor(target, onSaved);
  const [discard, setDiscard] = useState(false);
  const [locating, setLocating] = useState(false);
  const creating = target.kind === "provider" && !target.provider;
  const title =
    target.kind === "provider"
      ? creating
        ? t`添加地址`
        : t`编辑地址`
      : target.kind === "key"
        ? target.item
          ? t`编辑密钥`
          : t`添加密钥`
        : target.item
          ? t`编辑模型`
          : t`添加模型`;
  function close() {
    setLocating(false);
    if (!busy) {
      if (form.dirty) setDiscard(true);
      else onClose();
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogLayoutContent
          placement="responsive-page"
          className="ui-density-adaptive md:max-w-lg"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogLayoutHeader showCloseButton>
            <DialogTitle>{title}</DialogTitle>
          </DialogLayoutHeader>
          <DialogLayoutBody>
            <form
              id="ai-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void form.save();
              }}
              className="p-1"
            >
              <fieldset disabled={busy} className="min-w-0">
                <FieldGroup density="compact">
                  {target.kind === "provider" ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor="ai-name">
                          <Trans>名称</Trans>
                        </FieldLabel>
                        <Input
                          id="ai-name"
                          value={form.name}
                          onChange={(e) => form.setName(e.target.value)}
                          required
                          maxLength={80}
                          autoFocus
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="ai-url">
                          <Trans>服务地址</Trans>
                        </FieldLabel>
                        <Input
                          id="ai-url"
                          type="url"
                          value={form.baseUrl}
                          onChange={(e) => {
                            form.setBaseUrl(e.target.value);
                            form.setAddressConfirmed(false);
                          }}
                          required
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                        <FieldDescription>
                          <Trans>当前仅支持 OpenAI Responses 接口格式</Trans>
                        </FieldDescription>
                      </Field>
                      {form.addressChanged ? (
                        <Field orientation="horizontal">
                          <Checkbox
                            id="ai-address-confirm"
                            checked={form.addressConfirmed}
                            onCheckedChange={(value) =>
                              form.setAddressConfirmed(value === true)
                            }
                          />
                          <FieldLabel htmlFor="ai-address-confirm">
                            <Trans>
                              我确认将密钥和生成请求发送到新的服务地址。
                            </Trans>
                          </FieldLabel>
                        </Field>
                      ) : null}
                    </>
                  ) : null}
                  {creating || target.kind === "key" ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor="ai-key-label">
                          <Trans comment="AI 密钥的可复用名称，不是密钥值">
                            标签
                          </Trans>
                        </FieldLabel>
                        <CandidateInput
                          id="ai-key-label"
                          candidates={view.labelCandidates}
                          value={form.label}
                          onChange={form.setLabel}
                          disabled={busy}
                          maxLength={80}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="ai-key-secret">
                          <Trans>密钥值</Trans>
                        </FieldLabel>
                        <Input
                          ref={bindSecret}
                          id="ai-key-secret"
                          type="password"
                          autoComplete="new-password"
                          autoCapitalize="none"
                          spellCheck={false}
                          onChange={(e) => form.setKeyDirty(!!e.target.value)}
                          required={
                            creating || (target.kind === "key" && !target.item)
                          }
                          placeholder={
                            target.kind === "key" && target.item
                              ? t`留空则保留现有密钥`
                              : t`输入 API Key`
                          }
                        />
                        <FieldDescription>
                          <Trans>
                            已保存的密钥不会回显，只能输入新值覆盖。
                          </Trans>
                        </FieldDescription>
                      </Field>
                    </>
                  ) : null}
                  {creating || target.kind === "model" ? (
                    <Field>
                      <FieldLabel htmlFor="ai-model-id">
                        <Trans>模型</Trans>
                      </FieldLabel>
                      <CandidateInput
                        id="ai-model-id"
                        candidates={view.modelCandidates}
                        value={form.model}
                        onChange={form.setModel}
                        disabled={busy}
                        maxLength={256}
                      />
                    </Field>
                  ) : null}
                  {target.kind === "model" ? (
                    <Field>
                      <FieldLabel htmlFor="ai-display-name">
                        <Trans>显示名称（可选）</Trans>
                      </FieldLabel>
                      <Input
                        id="ai-display-name"
                        value={form.displayName}
                        onChange={(e) => form.setDisplayName(e.target.value)}
                        maxLength={80}
                      />
                    </Field>
                  ) : null}
                  {form.existing ? (
                    <Field>
                      <FieldDescription role="status">
                        <Trans>
                          此地址下已存在相同的标签或模型，可以打开已有项进行编辑。
                        </Trans>
                      </FieldDescription>
                      <Button
                        type="button"
                        variant="outline"
                        fullWidth
                        onClick={() => {
                          if (form.dirty) {
                            setLocating(true);
                            setDiscard(true);
                          } else if (form.existing) onLocate(form.existing);
                        }}
                      >
                        <Trans comment="打开当前 AI 服务地址中已存在的密钥或模型编辑表单，不启用该项">
                          打开已有项
                        </Trans>
                      </Button>
                    </Field>
                  ) : null}
                  {form.error ? (
                    <FieldError role="alert">
                      {typeof form.error === "string"
                        ? form.error
                        : describeError(form.error)}
                    </FieldError>
                  ) : null}
                  {form.stale ? (
                    <Field>
                      <FieldDescription>
                        <Trans>
                          配置已更新，草稿已保留。请核对最新配置后再保存。
                        </Trans>
                      </FieldDescription>
                      <Button
                        type="button"
                        variant="outline"
                        fullWidth
                        onClick={form.rebase}
                      >
                        <Trans>使用最新版本继续编辑</Trans>
                      </Button>
                    </Field>
                  ) : null}
                </FieldGroup>
              </fieldset>
            </form>
          </DialogLayoutBody>
          <DialogLayoutFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              <Trans>取消</Trans>
            </Button>
            <Button
              type="submit"
              form="ai-editor"
              disabled={busy || form.stale || !!form.existing}
            >
              {busy ? <Trans>正在保存</Trans> : <Trans>保存</Trans>}
            </Button>
          </DialogLayoutFooter>
        </DialogLayoutContent>
      </Dialog>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent className="ui-density-adaptive">
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>放弃未保存的修改？</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>本次输入的内容将被清除。</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>继续编辑</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (locating) {
                  if (form.existing) onLocate(form.existing);
                  setLocating(false);
                } else onClose();
              }}
            >
              <Trans>放弃修改</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
