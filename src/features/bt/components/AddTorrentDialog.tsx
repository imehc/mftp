import { Trans, useLingui } from "@lingui/react/macro";
import { FolderOpen, LoaderCircle, Magnet } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import {
  DialogLayoutBody,
  DialogLayoutContent,
  DialogLayoutFooter,
  DialogLayoutHeader,
} from "~/components/ui/dialog-layout";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { describeError } from "~/lib/errors";
import { formatBytes } from "~/lib/format";

import {
  type TorrentDraftOptions,
  useTorrentDraft,
} from "../use-torrent-draft";
import TorrentFileList, {
  BT_FILE_LIST_OVERHEAD,
  BT_FILE_ROW_HEIGHT_PX,
  BT_FILE_ROW_HEIGHT_REM,
} from "./TorrentFileList";

export type AddTorrentDialogProps = TorrentDraftOptions;

/** 页面只组合输入与结果；探测和启动请求由草稿 hook 管理。 */
export default function AddTorrentDialog(props: AddTorrentDialogProps) {
  const { open, readOnly = false } = props;
  const { t } = useLingui();
  const {
    source,
    changeSource,
    probing,
    probe,
    selected,
    starting,
    probeError,
    close,
    doProbe,
    pickTorrent,
    toggleFile,
    selectedBytes,
    duplicateTask,
    startDownload,
  } = useTorrentDraft(props);
  const visibleFileRows = probe ? Math.min(probe.files.length, 6) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogLayoutContent
        placement="responsive-page"
        showCloseButton={false}
        className="max-h-full md:max-w-120"
      >
        <DialogLayoutHeader showCloseButton={!starting}>
          <DialogTitle>
            {readOnly ? <Trans>查看资源信息</Trans> : <Trans>添加下载</Trans>}
          </DialogTitle>
          <DialogDescription className="sr-only">
            <Trans>支持磁力链接与本地 .torrent 文件</Trans>
          </DialogDescription>
        </DialogLayoutHeader>
        <DialogLayoutBody className="flex flex-col gap-4">
          {!readOnly ? (
            <div className="flex flex-col gap-3">
              <FieldGroup>
                <Field data-invalid={!!probeError}>
                  <FieldLabel htmlFor="bt-source">
                    <Trans>磁力链接</Trans>
                  </FieldLabel>
                  <Textarea
                    id="bt-source"
                    rows={3}
                    value={source}
                    disabled={probing || starting}
                    aria-invalid={!!probeError}
                    aria-describedby={
                      probeError ? "bt-source-error" : "bt-source-description"
                    }
                    onChange={(event) => changeSource(event.target.value)}
                    placeholder={t`磁力链接`}
                  />
                  <FieldDescription id="bt-source-description">
                    <Trans>支持磁力链接与本地 .torrent 文件</Trans>
                  </FieldDescription>
                  {probeError ? (
                    <FieldError id="bt-source-error">
                      {describeError(probeError, t)}
                    </FieldError>
                  ) : null}
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  fullWidth
                  disabled={probing || starting}
                  onClick={() => void pickTorrent()}
                >
                  <FolderOpen data-icon="inline-start" />
                  <Trans>选择种子文件</Trans>
                </Button>
                {!probe ? (
                  <Button
                    fullWidth
                    disabled={!source.trim() || probing || starting}
                    onClick={() => void doProbe(source)}
                  >
                    {probing ? (
                      <LoaderCircle
                        data-icon="inline-start"
                        className="animate-spin"
                      />
                    ) : (
                      <Magnet data-icon="inline-start" />
                    )}
                    <Trans>解析</Trans>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {probing ? (
            <p role="status" className="text-muted-foreground text-sm">
              <Trans>正在获取资源信息…</Trans>
            </p>
          ) : null}
          {starting ? (
            <p role="status" className="text-muted-foreground text-sm">
              <Trans>正在添加下载…</Trans>
            </p>
          ) : null}
          {probe ? (
            <section className="flex min-h-48 shrink-0 flex-col gap-3 rounded-xl border p-3">
              <h2 className="text-sm font-semibold">
                <Trans>解析结果</Trans>
              </h2>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 text-sm font-medium wrap-break-word">
                  {probe.name}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatBytes(selectedBytes)} / {formatBytes(probe.totalLen)}
                </span>
              </div>
              <div
                className="min-h-0"
                style={{
                  // 不用 calc 乘法：分别按 px/rem 展开后取较大值，兼容旧 WebView。
                  height: `max(calc(${visibleFileRows * BT_FILE_ROW_HEIGHT_PX}px + ${BT_FILE_LIST_OVERHEAD}), calc(${visibleFileRows * BT_FILE_ROW_HEIGHT_REM}rem + ${BT_FILE_LIST_OVERHEAD}))`,
                }}
              >
                <TorrentFileList
                  files={probe.files}
                  selected={selected}
                  onToggle={toggleFile}
                  readOnly={readOnly || starting}
                />
              </div>
            </section>
          ) : null}
          {probe && !readOnly ? (
            <p className="app-description">
              <Trans comment="下载完成后可把文件复制出应用沙盒">
                完成后可复制到其他目录
              </Trans>
            </p>
          ) : null}
          {duplicateTask ? (
            <p role="alert" className="text-destructive text-xs">
              <Trans>该资源已在下载列表中，不能重复添加</Trans>
            </p>
          ) : null}
        </DialogLayoutBody>
        <DialogLayoutFooter className="shrink-0">
          <Button variant="outline" disabled={starting} onClick={close}>
            {readOnly ? <Trans>关闭</Trans> : <Trans>取消</Trans>}
          </Button>
          {!readOnly ? (
            <Button
              disabled={
                !probe || selected.size === 0 || starting || duplicateTask
              }
              onClick={() => void startDownload()}
            >
              {starting ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              <Trans>开始下载</Trans>
            </Button>
          ) : null}
        </DialogLayoutFooter>
      </DialogLayoutContent>
    </Dialog>
  );
}
