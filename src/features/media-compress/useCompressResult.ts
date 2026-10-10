import { useEffect, useEffectEvent, useState } from "react";

import { createObjectUrlOwner } from "./object-url";

export interface CompressResultValue {
  blob: Blob;
  size: number;
  fileName: string;
}

interface CompressResultState {
  blob: Blob | null;
  size: number;
  fileName: string;
  url: string | null;
}

const EMPTY_RESULT: CompressResultState = {
  blob: null,
  size: 0,
  fileName: "",
  url: null,
};

export function useCompressResult() {
  const [urls] = useState(createObjectUrlOwner);
  const [result, setResultState] = useState(EMPTY_RESULT);

  const clearResult = () => {
    urls.clear();
    setResultState(EMPTY_RESULT);
  };

  const setResult = (next: CompressResultValue) => {
    const url = urls.replace(next.blob);
    setResultState({
      ...next,
      url,
    });
  };

  const setResultSize = (size: number) => {
    setResultState((current) => ({
      ...current,
      size,
    }));
  };

  // 仅在卸载时回收；与替换、清空共用同一 URL 所有者。
  const revokeOnUnmount = useEffectEvent(() => urls.clear());
  useEffect(() => revokeOnUnmount, []);
  return {
    result,
    clearResult,
    setResult,
    setResultSize,
  };
}
