export function parseRoomAddress(
  value: string,
): { host: string; port: number } | null {
  // IPv6 必须带方括号，避免把地址自身的冒号当成端口分隔符。
  const match = /^(?:\[([^\]\s]+)\]|([^:\s]+)):(\d{1,5})$/.exec(value.trim());
  if (!match) return null;
  const port = Number(match[3]);
  return port > 0 && port <= 65535
    ? { host: match[1] ?? match[2], port }
    : null;
}
