import type { BtProbeResult } from "~/types";

export interface PreviewProbeHandoff {
  source: string;
  probe: BtProbeResult;
  transferWasVisible: boolean;
  preparation?: Promise<unknown>;
}

let previewLaunch: PreviewProbeHandoff | null = null;

/** Remembers where the dialog was when it handed off to the preview page. */
export function markPreviewLaunch(
  source: string,
  probe: BtProbeResult,
  transferWasVisible: boolean,
) {
  previewLaunch = { source, probe, transferWasVisible };
}

/** Reads the active preview handoff without consuming the return state. */
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

/** Consumed once by the BT page on mount; null on a plain visit. */
export function takePreviewLaunch(): PreviewProbeHandoff | null {
  const handoff = previewLaunch;
  previewLaunch = null;
  return handoff;
}
