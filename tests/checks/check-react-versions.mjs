import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function readVersion(name) {
  const { version } = require(`${name}/package.json`);
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Missing version in ${name}/package.json.`);
  }
  return version;
}

try {
  // 比较实际安装版本，避免声明范围兼容但锁文件解析结果不一致时漏检。
  const reactVersion = readVersion("react");
  const reactDomVersion = readVersion("react-dom");

  if (reactVersion !== reactDomVersion) {
    throw new Error(
      `React version mismatch: react=${reactVersion}, react-dom=${reactDomVersion}. ` +
        "Both packages must have exactly the same version. " +
        "Update them together and regenerate pnpm-lock.yaml before building.",
    );
  }

  console.log(`React and React DOM versions are consistent: ${reactVersion}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
