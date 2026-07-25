import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
// iOS project files hardcode the version at `tauri ios init` time (Android
// instead reads it from tauri.properties on every build), so keep them synced.
const iosProjectPath = path.join(root, "src-tauri", "gen", "apple", "project.yml");
const iosPlistPath = path.join(root, "src-tauri", "gen", "apple", "mftp_iOS", "Info.plist");
const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readCargoVersion() {
  const raw = fs.readFileSync(cargoPath, "utf8");
  const match = raw.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error("Missing package version in src-tauri/Cargo.toml");
  return match[1];
}

function readIosVersions() {
  const yml = fs.readFileSync(iosProjectPath, "utf8");
  const ymlMatch = yml.match(/^\s*CFBundleShortVersionString:\s*"?([^"\s]+)"?\s*$/m);
  if (!ymlMatch) throw new Error("Missing CFBundleShortVersionString in gen/apple/project.yml");

  const plist = fs.readFileSync(iosPlistPath, "utf8");
  const plistMatch = plist.match(
    /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
  );
  if (!plistMatch) throw new Error("Missing CFBundleShortVersionString in gen/apple Info.plist");

  return { iosProject: ymlMatch[1], iosPlist: plistMatch[1] };
}

function readVersions() {
  return {
    packageJson: readJson(packagePath).version,
    cargoToml: readCargoVersion(),
    tauriConfig: readJson(tauriConfigPath).version,
    ...readIosVersions(),
  };
}

function checkVersions() {
  const versions = readVersions();
  const unique = new Set(Object.values(versions));
  const [version] = unique;

  if (unique.size !== 1) {
    throw new Error(
      `Version mismatch: package.json=${versions.packageJson}, Cargo.toml=${versions.cargoToml}, tauri.conf.json=${versions.tauriConfig}, gen/apple/project.yml=${versions.iosProject}, gen/apple Info.plist=${versions.iosPlist}`,
    );
  }

  if (!semver.test(version)) {
    throw new Error(`Version must be semver-like x.y.z: ${version}`);
  }

  console.log(`Version ${version} is consistent.`);
}

function nextVersion(current, target) {
  if (semver.test(target)) return target;

  const [major, minor, patch] = current.split(".").map((part) => Number.parseInt(part, 10));
  if (![major, minor, patch].every(Number.isInteger)) {
    throw new Error(`Cannot bump non-numeric version: ${current}`);
  }

  switch (target) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error("Usage: pnpm version:bump patch|minor|major|x.y.z");
  }
}

function bumpVersion(target) {
  if (!target) throw new Error("Usage: pnpm version:bump patch|minor|major|x.y.z");

  checkVersions();
  const current = readVersions().packageJson;
  const version = nextVersion(current, target);

  const pkg = readJson(packagePath);
  pkg.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  const tauriConfig = readJson(tauriConfigPath);
  tauriConfig.version = version;
  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

  const cargo = fs.readFileSync(cargoPath, "utf8");
  fs.writeFileSync(
    cargoPath,
    cargo.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`),
  );

  const yml = fs.readFileSync(iosProjectPath, "utf8");
  fs.writeFileSync(
    iosProjectPath,
    yml
      .replace(/^(\s*CFBundleShortVersionString:\s*)"?[^"\s]+"?\s*$/m, `$1${version}`)
      .replace(/^(\s*CFBundleVersion:\s*)"?[^"\s]+"?\s*$/m, `$1"${version}"`),
  );

  const plist = fs.readFileSync(iosPlistPath, "utf8");
  fs.writeFileSync(
    iosPlistPath,
    plist.replace(
      /(<key>CFBundle(?:ShortVersionString|Version)<\/key>\s*<string>)[^<]+(<\/string>)/g,
      `$1${version}$2`,
    ),
  );

  console.log(`Version bumped from ${current} to ${version}.`);
}

const [command, target] = process.argv.slice(2);

try {
  if (command === "check") {
    checkVersions();
  } else if (command === "bump") {
    bumpVersion(target);
  } else {
    throw new Error("Usage: node scripts/version.mjs check|bump");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
