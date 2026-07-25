import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectSpecFiles(dir, relativeTo = apiRoot) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSpecFiles(fullPath, relativeTo));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      files.push(path.relative(relativeTo, fullPath));
    }
  }
  return files;
}

const args = process.argv.slice(2);
let pathPattern = null;
const forwarded = [];

for (const arg of args) {
  if (arg.startsWith("--test-path-pattern=")) {
    pathPattern = arg.slice("--test-path-pattern=".length);
    continue;
  }
  forwarded.push(arg);
}

let specFiles = collectSpecFiles(path.join(apiRoot, "src"));

if (pathPattern) {
  const re = new RegExp(pathPattern);
  specFiles = specFiles.filter((file) => re.test(file));
  if (specFiles.length === 0) {
    console.error(`No spec files match --test-path-pattern=${pathPattern}`);
    process.exit(1);
  }
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...specFiles, ...forwarded],
  { stdio: "inherit", cwd: apiRoot },
);

process.exit(result.status ?? 1);
