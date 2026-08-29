import { useCallback, useEffect, useRef, useState } from "react";
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
 * BT side of the shared preview page: mints the loopback stream URL for one
 * file and adds the live stats footer. The engine restarts itself when the
 * page is opened cold (reload or deep link).
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
  // Stays true until the save event arrives: unfinished tasks are exported
  // only after the download completes.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
    return () => {
      cancelled = true;
    };
  }, [fileIndex, infoHash]);

  const showPeers = useCallback(() => setPeersOpen(true), []);
  const closePreview = useCallback(() => {
    if (previewTransferWasVisible(infoHash) === false) {
      dismissTransfer(`bt:${infoHash}`);
    }
  }, [dismissTransfer, infoHash]);

  // Both the immediate and the deferred export report through the task event,
  // so success is reported from one place for either path. The unlisten
  // handle arrives asynchronously: without the flag a cleanup that runs first
  // leaks the subscription and every later save toasts once per leak.
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | null = null;
    void listen<{ infoHash: string; kind: string }>(BT_TASK_EVENT, (event) => {
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

  /** Save the previewed file into a user directory (playback keeps running). */
  const download = useCallback(async () => {
    const picked = await openDialog({ multiple: false, directory: true });
    if (typeof picked !== "string") return;
    setSaving(true);
    try {
      await ipc.btSaveToLocal(infoHash, picked, fileIndex);
    } catch (e) {
      setSaving(false);
      toast.error(t`转存失败`, { description: String(e) });
    }
  }, [fileIndex, infoHash, t]);

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
                <LoaderCircle data-icon="inline-start" className="animate-spin" />
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
        task={peersOpen ? { infoHash, label: name } : null}
        onClose={() => setPeersOpen(false)}
      />
    </>
  );
}
