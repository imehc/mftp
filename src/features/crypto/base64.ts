export type Base64Variant = "standard" | "url-safe";

export interface Base64Result {
  ok: true;
  value: string;
}

export interface Base64Error {
  ok: false;
  error: string;
}

export type Base64Outcome = Base64Result | Base64Error;

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toUrlSafe(value: string, stripPadding: boolean): string {
  const encoded = value.replace(/\+/g, "-").replace(/\//g, "_");
  return stripPadding ? encoded.replace(/=+$/u, "") : encoded;
}

function fromUrlSafe(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function padBase64(value: string): string {
  const remainder = value.length % 4;
  if (remainder === 0) return value;
  if (remainder === 1) {
    throw new Error("invalid-length");
  }
  return `${value}${"=".repeat(4 - remainder)}`;
}

export function encodeBase64(
  input: string,
  variant: Base64Variant = "standard",
): Base64Outcome {
  try {
    const bytes = new TextEncoder().encode(input);
    const encoded = btoa(bytesToBinary(bytes));
    return {
      ok: true,
      value: variant === "url-safe" ? toUrlSafe(encoded, true) : encoded,
    };
  } catch {
    return { ok: false, error: "encode-failed" };
  }
}

export function decodeBase64(
  input: string,
  variant: Base64Variant = "standard",
): Base64Outcome {
  const compact = input.replace(/\s+/gu, "");
  if (!compact) {
    return { ok: true, value: "" };
  }

  try {
    const normalized =
      variant === "url-safe" ? fromUrlSafe(compact) : compact;
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
      return { ok: false, error: "invalid-base64" };
    }
    const padded = padBase64(normalized);
    const binary = atob(padded);
    return {
      ok: true,
      value: new TextDecoder().decode(binaryToBytes(binary)),
    };
  } catch {
    return { ok: false, error: "invalid-base64" };
  }
}
