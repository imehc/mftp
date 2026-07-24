import { useCallback, useEffect, useRef, useState } from "react";

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
  const urlRef = useRef<string | null>(null);
  const [result, setResultState] = useState(EMPTY_RESULT);

  const revokeCurrentUrl = useCallback(() => {
    if (!urlRef.current) return;
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const clearResult = useCallback(() => {
    revokeCurrentUrl();
    setResultState(EMPTY_RESULT);
  }, [revokeCurrentUrl]);

  const setResult = useCallback(
    (next: CompressResultValue) => {
      revokeCurrentUrl();
      const url = URL.createObjectURL(next.blob);
      urlRef.current = url;
      setResultState({ ...next, url });
    },
    [revokeCurrentUrl],
  );

  const setResultSize = useCallback((size: number) => {
    setResultState((current) => ({ ...current, size }));
  }, []);

  useEffect(() => revokeCurrentUrl, [revokeCurrentUrl]);

  return {
    result,
    clearResult,
    setResult,
    setResultSize,
  };
}
