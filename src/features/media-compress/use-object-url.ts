import { useEffect, useEffectEvent, useState } from "react";

import { createObjectUrlOwner } from "./object-url";

/** 只在用户换源时分配 URL；替换和卸载共用所有者，不在渲染/effect 中同步派生 state。 */
export function useObjectUrl() {
  const [owner] = useState(createObjectUrlOwner);
  const [url, setUrl] = useState<string | null>(null);
  const replaceUrl = (blob: Blob | null) => setUrl(owner.replace(blob));
  const clearOnUnmount = useEffectEvent(() => owner.clear());
  useEffect(() => clearOnUnmount, []);
  return { url, replaceUrl };
}
