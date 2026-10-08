import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const names = [
  "model-environment",
  "model-recording",
  "model-attachments",
  "model-system",
  "display-size",
];
const selected = process.argv.slice(2);
if (selected.some((name) => !names.includes(name)))
  throw new Error(`Choose from: ${names.join(", ")}`);
const output = fs.mkdtempSync(path.join(os.tmpdir(), "mftp-browser-qa-"));
const port = Number(process.env.QA_PORT || 1475);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid QA_PORT");
const base = `http://127.0.0.1:${port}`;
const vite = fileURLToPath(
  new URL("../../node_modules/vite/bin/vite.js", import.meta.url),
);
const summary = {
  startedAt: new Date().toISOString(),
  node: process.version,
  workingTreeDirty: Boolean(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: project,
      encoding: "utf8",
    }).trim(),
  ),
  baseline: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: project,
    encoding: "utf8",
  }).trim(),
  results: [],
};
const server = spawn(
  process.execPath,
  [
    vite,
    "--config",
    "tests/browser/vite.config.mjs",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: project, stdio: ["ignore", "pipe", "pipe"] },
);
const serverLog = fs.createWriteStream(path.join(output, "vite.log"));
server.stdout.pipe(serverLog);
server.stderr.pipe(serverLog);
console.log(`Browser QA output: ${output}`);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Vite startup timed out")),
      60000,
    );
    let text = "";
    server.stdout.on("data", (chunk) => {
      text += chunk;
      if (text.includes(base)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite exited: ${code}; see vite.log`));
    });
  });
  for (const name of selected.length ? selected : names) {
    const result = await new Promise((resolve) => {
      const log = fs.createWriteStream(path.join(output, `${name}.log`));
      const child = spawn(
        process.execPath,
        [path.join(project, "tests/browser", `${name}-check.mjs`)],
        {
          cwd: project,
          env: { ...process.env, QA_BASE_URL: base, QA_OUTPUT_DIR: output },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, 180000);
      child.once("error", (error) => {
        clearTimeout(timer);
        log.end(String(error));
        resolve({ name, passed: false, error: error.message });
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        log.end();
        resolve({ name, passed: code === 0 && !timedOut, code, timedOut });
      });
    });
    summary.results.push(result);
    console.log(`${name}: ${result.passed ? "passed" : "FAILED"}`);
  }
  if (summary.results.some((result) => !result.passed)) process.exitCode = 1;
} catch (error) {
  summary.error = error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  summary.finishedAt = new Date().toISOString();
  server.kill("SIGTERM");
  fs.writeFileSync(
    path.join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
}
