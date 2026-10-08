// 使用官方 ESM 入口，避免 CLI 的 CommonJS 启动器引入循环依赖。
if (process.argv.length !== 2)
  throw new Error("This script only generates routes");
process.argv.push("generate");
await import("@tanstack/router-cli");
