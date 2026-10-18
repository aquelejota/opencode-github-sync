import { spawnSync } from "node:child_process";
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

  it("ignores the runtime plugin directory but not the vendored plugin build", () => {
    // An unanchored `plugin/` also matched vendor/opencode-github-sync/dist/plugin/,
    // so the OpenCode 2 plugin build never reached the sync repository and each
    // machine had to copy it into vendor/ by hand.
    writeRepoMetadata(root);
    spawnSync("git", ["init", "-q", root]);

    const build = path.join("vendor", "opencode-github-sync", "dist", "plugin", "index.js");
    const ignored = spawnSync("git", ["-C", root, "check-ignore", "-v", build], {
      encoding: "utf8",
    });
    expect(ignored.status).not.toBe(0);
    expect(ignored.stdout).toBe("");

    // The runtime directory itself is still ignored.
    const runtime = spawnSync("git", ["-C", root, "check-ignore", "-v", "plugin/."], {
      encoding: "utf8",
    });
    expect(runtime.status).toBe(0);
  });
});
