import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeNetworkSecurity,
  outputUrl,
  upstreamSha256,
  verifierVersion,
} from "../../scripts/android-network-security.mjs";

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const policy = readFileSync(outputUrl, "utf8");
const localRules = [
  '    <domain-config cleartextTrafficPermitted="true">',
  '        <domain includeSubdomains="false">localhost</domain>',
  '        <domain includeSubdomains="false">127.0.0.1</domain>',
  "    </domain-config>\n",
].join("\n");

test("网络策略保留固定上游版本的完整白名单并可确定性重建", () => {
  assert.ok(policy.includes(localRules));
  const upstream = policy.replace(localRules, "");
  assert.equal(
    createHash("sha256").update(upstream).digest("hex"),
    upstreamSha256,
  );
  assert.equal(mergeNetworkSecurity(upstream), policy);
});

test("默认禁止明文流量且只为官方 CRL 域名和回环地址保留例外", () => {
  const domains = [...policy.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map(
    (match) => match[1],
  );
  assert.equal((policy.match(/<base-config/g) ?? []).length, 1);
  assert.ok(
    policy.includes('<base-config cleartextTrafficPermitted="false" />'),
  );
  assert.equal((policy.match(/<domain-config/g) ?? []).length, 2);
  for (const domain of [
    "crl3.digicert.com",
    "crl4.digicert.com",
    "c.pki.goog",
    "r13.c.lencr.org",
    "localhost",
    "127.0.0.1",
  ]) {
    assert.ok(domains.includes(domain), domain);
  }
  for (const domain of [
    "github.com",
    "release-assets.githubusercontent.com",
    "com",
  ]) {
    assert.ok(!domains.includes(domain), domain);
  }
  assert.equal(new Set(domains).size, domains.length);
});

test("应用 Manifest 使用整合后的策略且原生及 JVM 验证器版本一致", () => {
  const manifest = read(
    "src-tauri/gen/android/app/src/main/AndroidManifest.xml",
  );
  const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
  const cargo = read("src-tauri/Cargo.toml");
  const lock = read("src-tauri/Cargo.lock");
  assert.ok(
    manifest.includes(
      'android:networkSecurityConfig="@xml/network_security_config"',
    ),
  );
  assert.ok(cargo.includes(`rustls-platform-verifier = "${verifierVersion}"`));
  assert.ok(
    lock.includes(
      `name = "rustls-platform-verifier"\nversion = "${verifierVersion}"`,
    ),
  );
  assert.ok(
    lock.includes(
      'name = "rustls-platform-verifier-android"\nversion = "0.2.0"',
    ),
  );
  assert.ok(
    gradle.includes('it["name"] == "rustls-platform-verifier-android"'),
  );
  assert.ok(
    gradle.includes(
      'implementation("org.rustls:rustls-platform-verifier:${rustlsVerifier.get()}")',
    ),
  );
  assert.ok(
    gradle.includes("raw/maven-archive/android-release-support/maven/"),
  );
  assert.ok(
    gradle.includes('includeModule("org.rustls", "rustls-platform-verifier")'),
  );
  assert.ok(!gradle.includes('parentFile.resolve("maven")'));
});

test("生成器拒绝缺失默认安全策略的上游输入", () => {
  assert.throws(
    () =>
      mergeNetworkSecurity(
        '<network-security-config><domain-config cleartextTrafficPermitted="true" /></network-security-config>',
      ),
    /Unexpected upstream/,
  );
});
