import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useStore } from "zustand";

import { describeError } from "~/lib/errors";

import { createNoteDraft } from "./note-draft";

export function useNoteDraft(itemId: string | null) {
  const { t } = useLingui();
  const [session] = useState(() =>
    createNoteDraft(itemId, (error) => {
      toast.error(t`清理备注草稿失败`, {
        description: describeError(error, t),
      });
    }),
  );
  const state = useStore(session.store);
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  return { ...state, retry: session.start };
}
