import { useQuery } from "@tanstack/react-query";

import { poemQuery } from "../queries";

/** 详情只跟随路由读取；结果带作品标识，路由切换的首帧也不会显示上一首诗。 */
export function usePoemRead(uid?: string) {
  const query = useQuery(poemQuery(uid ?? ""));
  return {
    detail: query.data ?? null,
    error: query.error?.payload ?? null,
    loading: query.isLoading,
    retry: () => {
      if (uid?.trim()) void query.refetch({ cancelRefetch: false });
    },
  };
}
