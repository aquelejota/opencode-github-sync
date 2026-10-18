import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Roots } from "../src/core/paths.js";
import {
  appendProgress,
  beginProgress,
  progressFilePath,
  splitProgressLines,
} from "../src/plugin/progress-file.js";

let tmp: string;
let roots: Roots;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-progress-"));
  roots = { state: tmp } as Roots;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("progressFile helpers", () => {
  it("resolves the log file inside the state root", () => {
    expect(progressFilePath(roots)).toBe(path.join(tmp, "opencode-github-sync-progress.jsonl"));
  });

  it("begins a fresh log, truncating whatever was there", () => {
    appendProgress(roots, "old entry", "info");
    beginProgress(roots, "push");
    const raw = fs.readFileSync(progressFilePath(roots), "utf8");
    expect(raw).not.toContain("old entry");
    const parsed = JSON.parse(raw.trim());
    expect(parsed).toMatchObject({ kind: "begin", action: "push" });
  });

  it("appends toast entries readable in order", () => {
    beginProgress(roots, "pull");
    appendProgress(roots, "Sync: checking the repository…", "info");
    appendProgress(roots, "Sync: applied 3 file(s) in 2s", "success");
    const toasts = splitProgressLines(fs.readFileSync(progressFilePath(roots), "utf8"));
    expect(toasts).toEqual([
      { message: "Sync: checking the repository…", variant: "info" },
      { message: "Sync: applied 3 file(s) in 2s", variant: "success" },
    ]);
  });

  it("creates the state directory when missing", () => {
    const deep = path.join(tmp, "nested", "state");
    beginProgress({ state: deep } as Roots, "push");
    expect(fs.existsSync(path.join(deep, "opencode-github-sync-progress.jsonl"))).toBe(true);
  });
});

describe("splitProgressLines", () => {
  it("skips begin markers, blanks and garbage, keeping toasts", () => {
    const raw = [
      JSON.stringify({ kind: "begin", action: "push", at: 1 }),
      "",
      "not json",
      JSON.stringify({
        kind: "toast",
        message: "Sync: sent 2 file(s) in 1s",
        variant: "success",
        at: 2,
      }),
      JSON.stringify({
        kind: "toast",
        message: "Sync failed: repo unreachable",
        variant: "error",
        at: 3,
      }),
      "{ partially written",
    ].join("\n");
    expect(splitProgressLines(raw)).toEqual([
      { message: "Sync: sent 2 file(s) in 1s", variant: "success" },
      { message: "Sync failed: repo unreachable", variant: "error" },
    ]);
  });

  it("defaults a missing variant to info and drops entries without a message", () => {
    const raw = [
      JSON.stringify({ kind: "toast", message: "hello" }),
      JSON.stringify({ kind: "toast", variant: "info" }),
    ].join("\n");
    expect(splitProgressLines(raw)).toEqual([{ message: "hello", variant: "info" }]);
  });
});

describe("desktop notification flag", () => {
  it("round-trips the notify flag the plugin uses for alerts", () => {
    appendProgress(roots, "Sync repo at 1.6 GB — run /compact-sync", "warning", true);
    const raw = fs.readFileSync(progressFilePath(roots), "utf8");
    expect(JSON.parse(raw.trim()).notify).toBe(true);
    expect(splitProgressLines(raw)).toEqual([
      { message: "Sync repo at 1.6 GB — run /compact-sync", variant: "warning", notify: true },
    ]);
  });

  it("leaves ordinary toasts without the flag", () => {
    appendProgress(roots, "Sync: sent 12 file(s) in 3s", "success");
    expect(splitProgressLines(fs.readFileSync(progressFilePath(roots), "utf8"))).toEqual([
      { message: "Sync: sent 12 file(s) in 3s", variant: "success" },
    ]);
  });
});
