import { useLingui } from "@lingui/react/macro";
import { toast } from "sonner";

import PoetrySyncStatus from "~/features/poetry/components/PoetrySyncStatus";
import { usePoetryStore } from "~/features/poetry/store/poetry-store";
import { usePoetrySyncProgress } from "~/features/poetry/sync-progress";
import { describeError } from "~/lib/errors";
import * as ipc from "~/lib/ipc";

/** 活动面板中的同步卡片；数据管理页复用同一状态块。 */
export default function PoetrySyncActivity() {
  const { t } = useLingui();
  const progress = usePoetrySyncProgress();
  const collections = usePoetryStore((state) => state.collections);

  const cancel = async () => {
    try {
      await ipc.poetrySyncCancel();
    } catch (error) {
      toast.error(t`操作失败`, { description: describeError(error) });
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
