import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { outputUrl } from "../../scripts/android-network-security.mjs";

const [input, expectedId = "com.imehc.mftp.dev"] = process.argv.slice(2);
assert.ok(
  input,
  "Usage: node tests/checks/check-android-tls-artifact.mjs <apk> [applicationId]",
);
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
assert.ok(sdk, "Set ANDROID_HOME or ANDROID_SDK_ROOT");
const version = readdirSync(join(sdk, "build-tools"))
  .filter((name) => existsSync(join(sdk, "build-tools", name, "aapt2")))
  .sort((first, second) =>
    second.localeCompare(first, undefined, { numeric: true }),
  )[0];
assert.ok(version, "Android SDK build-tools with aapt2 are required");
const artifact = resolve(input);
const aapt = (...args) =>
  execFileSync(join(sdk, "build-tools", version, "aapt2"), args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
const policy = aapt(
  "dump",
  "xmltree",
  artifact,
  "--file",
  "res/xml/network_security_config.xml",
);
const domains = [
  ...policy.matchAll(/A: includeSubdomains=(true|false)\s+T: '([^']+)'/g),
]
  .map((match) => [match[2], match[1]])
  .sort();
const sourceDomains = [
  ...readFileSync(outputUrl, "utf8").matchAll(
    /<domain includeSubdomains="(true|false)">([^<]+)<\/domain>/g,
  ),
]
  .map((match) => [match[2], match[1]])
  .sort();
assert.deepEqual(
  domains,
  sourceDomains,
  "Packaged CA/loopback rules differ from source",
);
assert.match(
  policy,
  /E: base-config[^\n]*\n\s+A: cleartextTrafficPermitted=false/,
);
assert.equal((policy.match(/E: base-config/g) ?? []).length, 1);
assert.equal((policy.match(/E: domain-config/g) ?? []).length, 2);
assert.ok(!policy.includes("E: trust-anchors"));
const resources = aapt("dump", "resources", artifact);
const resourceId = resources.match(
  /resource (0x[\da-f]+) xml\/network_security_config\b/i,
)?.[1];
assert.ok(resourceId, "Packaged network security resource missing");
const manifest = aapt(
  "dump",
  "xmltree",
  artifact,
  "--file",
  "AndroidManifest.xml",
);
assert.match(
  manifest,
  new RegExp(`android:networkSecurityConfig\\([^)]*\\)=@${resourceId}\\b`),
);
const badging = aapt("dump", "badging", artifact);
assert.equal(badging.match(/package: name='([^']+)'/)?.[1], expectedId);
const project = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
assert.equal(badging.match(/versionName='([^']+)'/)?.[1], project.version);
assert.match(badging, /native-code: 'arm64-v8a'\s*$/m);
console.log(
  JSON.stringify({
    package: expectedId,
    version: project.version,
    versionCode: badging.match(/versionCode='([^']+)'/)?.[1],
    abi: "arm64-v8a",
    domainRules: domains.length,
    defaultCleartext: false,
  }),
);
