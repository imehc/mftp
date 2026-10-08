import { useLingui } from "@lingui/react/macro";
import { useState } from "react";

import { decodeBase64, encodeBase64 } from "./base64";

export function useCrypto() {
  const { t } = useLingui();
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [urlSafe, setUrlSafe] = useState(false);
  const [input, setInput] = useState("");
  const variant = urlSafe ? "url-safe" : "standard";
  const outcome =
    mode === "encode"
      ? encodeBase64(input, variant)
      : decodeBase64(input, variant);
  const output = outcome.ok ? outcome.value : "";
  const error = !outcome.ok
    ? outcome.error === "invalid-base64"
      ? t`内容无效，无法解码`
      : t`编码失败`
    : null;

  function swap() {
    if (!outcome.ok || !output) return;
    setInput(output);
    setMode(mode === "encode" ? "decode" : "encode");
  }

  return {
    mode,
    setMode,
    urlSafe,
    setUrlSafe,
    input,
    setInput,
    output,
    error,
    swap,
  };
}
