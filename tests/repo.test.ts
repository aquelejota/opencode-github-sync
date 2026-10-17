import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GITATTRIBUTES, DEFAULT_GITIGNORE, writeRepoMetadata } from "../src/core/repo.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ogs-repo-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("repository metadata", () => {
  it("ignores the machine-local service password", () => {
    // `service.json` holds the OpenCode 2 background-service password. It is
    // written per machine, and `git add -A` would otherwise commit it on the
    // next auto-push.
    expect(DEFAULT_GITIGNORE).toContain("service.json");
  });

  it("writes both metadata files, even when they already exist", () => {
    // A hand-edited .gitignore must not survive: the default is authoritative.
    fs.writeFileSync(path.join(root, ".gitignore"), "# hand edited\n");
    writeRepoMetadata(root);

    const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(ignore).toBe(DEFAULT_GITIGNORE);
    expect(ignore).toContain("service.json");
    expect(fs.readFileSync(path.join(root, ".gitattributes"), "utf8")).toBe(DEFAULT_GITATTRIBUTES);
  });
});
