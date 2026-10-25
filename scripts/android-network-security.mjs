import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const verifierVersion = "0.7.1";
export const upstreamSha256 =
  "a81434f9139f3780412c358d1cc782fe25339182d3dc141b35413f23d2b29f6a";
export const upstreamUrl = `https://raw.githubusercontent.com/rustls/rustls-platform-verifier/v/${verifierVersion}/android/rustls-platform-verifier/src/main/res/xml/network_security_config.xml`;
export const outputUrl = new URL(
  "../src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml",
  import.meta.url,
);

export function mergeNetworkSecurity(upstream) {
  if (
    !upstream.includes("<network-security-config>") ||
    !upstream.includes("</network-security-config>") ||
    !upstream.includes('<base-config cleartextTrafficPermitted="false" />') ||
    !upstream.includes('cleartextTrafficPermitted="true"')
  ) {
    throw new Error("Unexpected upstream Android network security config");
  }

  return upstream.replace(
    "</network-security-config>",
    [
      '    <domain-config cleartextTrafficPermitted="true">',
      '        <domain includeSubdomains="false">localhost</domain>',
      '        <domain includeSubdomains="false">127.0.0.1</domain>',
      "    </domain-config>",
      "</network-security-config>",
    ].join("\n"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--source")) {
    throw new Error(
      "Usage: pnpm android:network-security [--source upstream.xml]",
    );
  }

  let upstream;
  if (args.length) {
    upstream = readFileSync(args[1], "utf8");
  } else {
    upstream = execFileSync(
      "curl",
      [
        "--fail",
        "--location",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--connect-timeout",
        "15",
        "--max-time",
        "60",
        "--silent",
        "--show-error",
        upstreamUrl,
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  }

  if (createHash("sha256").update(upstream).digest("hex") !== upstreamSha256) {
    throw new Error("Upstream Android network policy checksum mismatch");
  }

  writeFileSync(outputUrl, mergeNetworkSecurity(upstream));
  console.log(
    `Android network policy generated from verifier ${verifierVersion}`,
  );
}
import { execFileSync } from "node:child_process";
