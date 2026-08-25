import { useEffect, useRef, useState } from "react";

/**
 * Debounced search input: returns the live input value plus the settled
 * query (300ms) that should trigger IPC. Keeps typing snappy on huge
 * result sets while remaining responsive to scope changes.
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

  useEffect(
    () => () => clearTimeout(timerRef.current),
    [],
  );

  return { input, setInput, query };
}
