import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = new URL(process.env.QA_BASE_URL || "http://127.0.0.1:1475");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname))
  throw new Error("QA requires a loopback Vite server");
const output =
  process.env.QA_OUTPUT_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "mftp-browser-qa-"));
fs.mkdirSync(output, { recursive: true });
export const fixture = (name) =>
  new URL(`/tests/browser/fixtures/${name}`, base).href;
export const artifact = (name) => path.join(output, path.basename(name));
