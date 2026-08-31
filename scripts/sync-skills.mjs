import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const lockPath = path.join(root, "skills-lock.json");

// `.agents/skills/` is gitignored and rebuilt from skills-lock.json, so the lock
// file is the only source of truth for which third-party skills a clone needs.
function readLock() {
  if (!fs.existsSync(lockPath)) {
    throw new Error("Missing skills-lock.json at repo root");
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const skills = lock.skills ?? {};
  const bySource = new Map();
  for (const [name, entry] of Object.entries(skills)) {
    if (!entry?.source) continue;
    if (!bySource.has(entry.source)) bySource.set(entry.source, []);
    bySource.get(entry.source).push(name);
  }
  return bySource;
}

function run(args) {
  const result = spawnSync("npx", ["skills", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const bySource = readLock();
  const failures = [];

  for (const [source, names] of bySource) {
    const cmd = ["add", source, ...names.flatMap((name) => ["--skill", name]), "-y"];
    console.log(`\n> npx skills ${cmd.join(" ")}`);
    if (dryRun) continue;
    if (run(cmd) !== 0) failures.push(source);
  }

  if (dryRun) return;

  const total = [...bySource.values()].reduce((sum, names) => sum + names.length, 0);
  if (failures.length > 0) {
    console.error(`\nSynced ${total} skills with ${failures.length} failing source(s): ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nSynced ${total} skills from ${bySource.size} source(s).`);
}

main();
