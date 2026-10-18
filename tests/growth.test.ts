import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REPO_SIZE_ALERT_BYTES,
  REPO_SIZE_ALERT_INTERVAL_MS,
  repoBytes,
  shouldWarnRepoSize,
} from "../src/core/sync.js";

const GB = 1073741824;

describe("repository size nudge", () => {
  it("stays quiet below the limit", () => {
    expect(shouldWarnRepoSize(1.3 * GB, 0, Date.now())).toBe(false);
  });

  it("speaks up once the repository passes the limit", () => {
    expect(shouldWarnRepoSize(REPO_SIZE_ALERT_BYTES + 1, 0, Date.now())).toBe(true);
  });

  it("does not repeat before the interval, and repeats after it", () => {
    const now = Date.now();
    const bytes = 2 * GB;
    expect(shouldWarnRepoSize(bytes, now - 24 * 60 * 60 * 1000, now)).toBe(false);
    expect(shouldWarnRepoSize(bytes, now - REPO_SIZE_ALERT_INTERVAL_MS - 1, now)).toBe(true);
  });

  it("can be turned off with a zero limit", () => {
    expect(shouldWarnRepoSize(10 * GB, 0, Date.now(), 0)).toBe(false);
  });
});

describe("repoBytes", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogs-growth-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports what git accounts for", () => {
    fs.writeFileSync(path.join(dir, "blob.bin"), "x".repeat(64 * 1024));
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "c"], { cwd: dir });

    expect(repoBytes(dir)).toBeGreaterThan(0);
    expect(repoBytes(path.join(dir, "nao-existe"))).toBe(0);
  });
});
