import { useEffect, useEffectEvent, useRef, useState } from "react";
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
  const revokeCurrentUrl = () => {
    if (!urlRef.current) return;
    URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  const clearResult = () => {
    revokeCurrentUrl();
    setResultState(EMPTY_RESULT);
  };
  const setResult = (next: CompressResultValue) => {
    revokeCurrentUrl();
    const url = URL.createObjectURL(next.blob);
    urlRef.current = url;
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
  // 仅在卸载时回收；revokeCurrentUrl 与上方的 setter 共享。
  const revokeOnUnmount = useEffectEvent(revokeCurrentUrl);
  useEffect(() => revokeOnUnmount, []);
  return {
    result,
    clearResult,
    setResult,
    setResultSize,
  };
}
