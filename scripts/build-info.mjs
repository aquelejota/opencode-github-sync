#!/usr/bin/env node
// Writes dist/build-info.json so a running copy can report the build it came from.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

let commit = git(["rev-parse", "--short", "HEAD"]) || "unknown";
// A dirty tree means the built dist does not match that commit exactly.
if (commit !== "unknown" && git(["status", "--porcelain"])) commit += "+dirty";

const info = { version, commit, builtAt: new Date().toISOString() };
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
console.log(`build-info: ${version} ${commit} (${info.builtAt})`);
