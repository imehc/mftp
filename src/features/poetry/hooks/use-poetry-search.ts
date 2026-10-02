import { useEffect, useRef, useState } from "react";

/**
 * 防抖搜索输入：返回实时输入值，以及应在 300ms 后触发 IPC 的
 * 稳定查询。在大量结果下保持输入流畅，同时响应范围切换。
 */
export function useDebouncedQuery(delayMs = 300, initialInput = "") {
  // 从路由恢复时首帧就采用已有查询，避免空值在防抖完成前回写 URL。
  const [input, setInput] = useState(initialInput);
  const [query, setQuery] = useState(initialInput.trim());
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
