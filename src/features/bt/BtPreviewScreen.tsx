import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HardDriveDownload, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import * as ipc from "~/lib/ipc";
import { translate } from "~/i18n/translate";
import { BT_TASK_EVENT } from "~/lib/events";
import type { PreviewKind } from "~/lib/preview-kind";
import PreviewScreen from "~/features/preview/PreviewScreen";
import { useTransfersStore } from "~/store/transfers";
import BtStatsBar from "./components/BtStatsBar";
import PeersDialog from "./components/PeersDialog";
import {
  markPreviewPreparation,
  previewSource,
  previewTransferWasVisible,
} from "./probe-cache";
export interface BtPreviewScreenProps {
  infoHash: string;
  fileIndex: number;
  name: string;
  kind: PreviewKind;
}

/**
 * 共享预览页的 BT 侧：为单个文件生成回环流 URL，并
 * 追加实时统计底栏。页面冷启动（刷新或深链接）时引擎会自行重启。
 */
export default function BtPreviewScreen({
  infoHash,
  fileIndex,
  name,
  kind,
}: BtPreviewScreenProps) {
  const { t } = useLingui();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peersOpen, setPeersOpen] = useState(false);
  const dismissTransfer = useTransfersStore((state) => state.dismiss);
  const preparationRef = useRef<{
    key: string;
    promise: Promise<string>;
  } | null>(null);
  // 在收到保存事件前保持 true：未完成的任务要等下载完成后才会导出。
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // 用微任务延后，使重置与拉取都发生在 effect 函数体之外；此处的
    // 状态更新要么在 await 之后，要么已被 `cancelled` 保护。
    queueMicrotask(() => {
      setUrl(null);
      setError(null);
      void (async () => {
        try {
          const preparationKey = `${infoHash}:${fileIndex}`;
          if (preparationRef.current?.key !== preparationKey) {
            preparationRef.current = {
              key: preparationKey,
              promise: (async () => {
                const source = previewSource(infoHash);
                if (source) {
                  await ipc.btEnsurePreview(source, fileIndex);
                }
                return ipc.btStreamUrl(infoHash, fileIndex);
              })(),
            };
            markPreviewPreparation(infoHash, preparationRef.current.promise);
          }
          const resolved = await preparationRef.current.promise;
          if (!cancelled) setUrl(resolved);
        } catch (e) {
          if (!cancelled) setError(String(e));
        }
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [fileIndex, infoHash]);
  const showPeers = () => setPeersOpen(true);
  const closePreview = () => {
    if (previewTransferWasVisible(infoHash) === false) {
      dismissTransfer(`bt:${infoHash}`);
    }
  };

  // 即时与延后的导出都通过任务事件上报，因此无论走哪条路径，成功
  // 都从同一处报告。unlisten 句柄异步到达：没有该标志的话，先运行的
  // 清理会泄漏订阅，且之后的每次保存都会重复弹出一次提示。
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{
      infoHash: string;
      kind: string;
    }>(BT_TASK_EVENT, (event) => {
      if (event.payload.infoHash !== infoHash) return;
      if (event.payload.kind === "saved") {
        setSaving(false);
        toast.success(translate(msg`已转存到本地`));
      } else if (event.payload.kind.startsWith("save-failed")) {
        setSaving(false);
        toast.error(translate(msg`转存失败`), {
          description: event.payload.kind.slice("save-failed:".length),
        });
      }
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [infoHash]);

  /** 把预览的文件保存到用户目录（播放仍会继续进行）。 */
  const download = async () => {
    const picked = await openDialog({
      multiple: false,
      directory: true,
    });
    if (typeof picked !== "string") return;
    setSaving(true);
    try {
      await ipc.btSaveToLocal(infoHash, picked, fileIndex);
    } catch (e) {
      setSaving(false);
      toast.error(t`转存失败`, {
        description: String(e),
      });
    }
  };
  return (
    <>
      <PreviewScreen
        name={name}
        kind={kind}
        url={url}
        error={error}
        loadingLabel={<Trans>正在准备在线预览…</Trans>}
        trailing={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void download()}
              disabled={saving}
            >
              {saving ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <HardDriveDownload data-icon="inline-start" />
              )}
              <Trans>下载</Trans>
            </Button>
            <Button variant="ghost" size="xs" asChild>
              <Link to="/tools/bt" onClick={closePreview}>
                <X data-icon="inline-start" />
                <Trans context="action">关闭</Trans>
              </Link>
            </Button>
          </div>
        }
        footer={<BtStatsBar infoHash={infoHash} onShowPeers={showPeers} />}
      />
      <PeersDialog
        task={
          peersOpen
            ? {
                infoHash,
                label: name,
              }
            : null
        }
        onClose={() => setPeersOpen(false)}
      />
    </>
  );
}
