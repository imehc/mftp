import { useEffect, useRef, useState } from "react";

/**
 * 防抖搜索输入：返回实时输入值，以及应在 300ms 后触发 IPC 的
 * 稳定查询。在大量结果下保持输入流畅，同时响应范围切换。
 */
export function useDebouncedQuery(delayMs = 300) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setQuery(input.trim());
    }, delayMs);
    return () => clearTimeout(timerRef.current);
  }, [input, delayMs]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { input, setInput, query };
}
