import { useEffect, useState } from "react";

import { toIpcError } from "~/lib/errors";
import { poetryPoem } from "~/lib/ipc";
import type { AppError, PoemDetail } from "~/types";

/** 详情只跟随路由读取；结果带作品标识，路由切换的首帧也不会显示上一首诗。 */
export function usePoemRead(uid?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    uid?: string;
    revision: number;
    detail: PoemDetail | null;
    error: AppError | null;
  }>({ revision: -1, detail: null, error: null });
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    void poetryPoem(uid).then(
      (detail) => {
        if (!cancelled) setState({ uid, revision, detail, error: null });
      },
      (error) => {
        if (!cancelled)
          setState({
            uid,
            revision,
            detail: null,
            error: toIpcError(error).payload,
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uid, revision]);
  const current = state.uid === uid && state.revision === revision;
  return {
    detail: current ? state.detail : null,
    error: current ? state.error : null,
    loading: !!uid && !current,
    retry: () => setRevision((value) => value + 1),
  };
}
