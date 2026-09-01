import type { BtProbeResult } from "~/types";

export interface PreviewProbeHandoff {
  source: string;
  probe: BtProbeResult;
  transferWasVisible: boolean;
  preparation?: Promise<unknown>;
}

let previewLaunch: PreviewProbeHandoff | null = null;

/** 记录对话框移交给预览页时的位置。 */
export function markPreviewLaunch(
  source: string,
  probe: BtProbeResult,
  transferWasVisible: boolean,
) {
  previewLaunch = { source, probe, transferWasVisible };
}

/** 读取当前活跃的预览交接信息，但不消费返回状态。 */
export function previewSource(infoHash: string): string | null {
  return previewLaunch?.probe.infoHash === infoHash
    ? previewLaunch.source
    : null;
}

export function previewTransferWasVisible(infoHash: string): boolean | null {
  return previewLaunch?.probe.infoHash === infoHash
    ? previewLaunch.transferWasVisible
    : null;
}

export function markPreviewPreparation(
  infoHash: string,
  preparation: Promise<unknown>,
) {
  if (previewLaunch?.probe.infoHash === infoHash) {
    previewLaunch.preparation = preparation;
  }
}

export function clearPreviewLaunch() {
  previewLaunch = null;
}

/** 由 BT 页在挂载时消费一次；普通访问时为 null。 */
export function takePreviewLaunch(): PreviewProbeHandoff | null {
  const handoff = previewLaunch;
  previewLaunch = null;
  return handoff;
}
