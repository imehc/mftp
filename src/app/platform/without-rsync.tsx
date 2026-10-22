import { Trans, useLingui } from "@lingui/react/macro";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type {
  RsyncIntegration,
  UseRsyncIntegrationOptions,
} from "~/features/ssh-sftp/components/sftp/rsync-contract";
import { useSettingsStore } from "~/store/settings";

/** 不支持 rsync 的产物：保留共用设置与入口，明确拒绝目录同步。 */
export function useRsyncIntegration(
  _options: UseRsyncIntegrationOptions,
): RsyncIntegration {
  const { t } = useLingui();
  const active = useSettingsStore(
    (state) => state.directoryTransferMode === "rsync",
  );
  const message = t`当前平台不支持 rsync，请选择压缩包或直连。`;
  return {
    supported: false,
    active,
    startPreview: async () => {
      toast.error(message);
    },
    notice: active ? (
      <Alert variant="destructive" className="mx-3 mt-3 shrink-0">
        <TriangleAlert />
        <AlertTitle>
          <Trans>rsync 当前平台不可用</Trans>
        </AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    ) : null,
    dialog: null,
  };
}
