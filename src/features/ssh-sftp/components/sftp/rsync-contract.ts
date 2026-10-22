import type { ReactNode } from "react";

import type { RsyncDirection } from "~/bindings";

/** rsync 目录同步请求；路径在打开预览时固定，后续设置变化不回写。 */
export interface RsyncSyncRequest {
  direction: RsyncDirection;
  localDir: string;
  remoteDir: string;
  displayName: string;
}

export interface RsyncIntegration {
  supported: boolean;
  active: boolean;
  startPreview: (request: RsyncSyncRequest) => Promise<void>;
  notice: ReactNode;
  dialog: ReactNode;
}

export interface UseRsyncIntegrationOptions {
  sessionId: string;
  onUploaded: () => Promise<void> | void;
}
