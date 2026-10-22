import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
export const platformManifest = JSON.parse(
  readFileSync(
    new URL("../config/platform-capabilities.json", import.meta.url),
    "utf8",
  ),
);

export function normalizePlatform(value) {
  if (!value) return null;
  if (value === "darwin" || value.includes("apple-darwin")) return "macos";
  if (value === "win32" || value.includes("windows")) return "windows";
  if (value.includes("android")) return "android";
  if (value.includes("ios")) return "ios";
  if (value.includes("linux")) return "linux";
  if (value === "macos") return value;
  throw new Error(`Unsupported build platform: ${value}`);
}

export function buildPlatform(
  env = process.env,
  explicit,
  host = process.platform,
) {
  const native = normalizePlatform(env.TAURI_ENV_PLATFORM);
  const selected = normalizePlatform(explicit ?? env.MFTP_BUILD_PLATFORM);
  if (native && selected && native !== selected)
    throw new Error(`Platform mismatch: Tauri ${native}, frontend ${selected}`);
  return native ?? selected ?? normalizePlatform(host);
}

export function platformGroup(target) {
  return ["macos", "windows", "linux"].includes(target) ? "desktop" : target;
}

export function supports(target, capability) {
  const spec = platformManifest.capabilities[capability];
  if (!spec) throw new Error(`Unknown capability: ${capability}`);
  // 精确平台优先；仍兼容历史分组（desktop/android/ios/mobile）。
  return (
    !target ||
    spec.platforms.includes(target) ||
    spec.platforms.includes(platformGroup(target))
  );
}

export function excludedSources(target) {
  return Object.entries(platformManifest.capabilities)
    .filter(([key]) => !supports(target, key))
    .flatMap(([, spec]) => spec.sources);
}

export function sourceIncluded(target, name) {
  return !excludedSources(target).some((prefix) =>
    prefix.endsWith("/") ? name.startsWith(prefix) : name === prefix,
  );
}

export function ignoredRoutes(target) {
  return Object.entries(platformManifest.capabilities)
    .filter(([key]) => !supports(target, key))
    .flatMap(([, spec]) => spec.routes);
}
