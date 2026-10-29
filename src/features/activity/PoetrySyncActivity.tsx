import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import PoetrySyncStatus from "~/features/poetry/components/PoetrySyncStatus";
import { collectionsQuery } from "~/features/poetry/queries";
import { usePoetrySyncProgress } from "~/features/poetry/sync-progress";
import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";

/** 活动面板中的同步卡片；数据管理页复用同一状态块。 */
export default function PoetrySyncActivity() {
  const { t } = useLingui();
  const progress = usePoetrySyncProgress();
  const { data: collections = [] } = useQuery(collectionsQuery());

  const cancel = async () => {
    try {
      await ipc.poetrySyncCancel();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error, t) });
    }
  };

  return (
    <PoetrySyncStatus
      progress={progress}
      collections={collections}
      onCancel={cancel}
    />
  );
}
