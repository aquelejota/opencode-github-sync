import { describe, expect, it } from "vitest";
import { formatDuration, phaseLabel } from "../src/plugin/progress.js";

describe("formatDuration", () => {
  it("shows plain seconds under a minute", () => {
    expect(formatDuration(42)).toBe("42s");
  });

  it("shows minutes with zero-padded seconds", () => {
    expect(formatDuration(187)).toBe("3m 07s");
  });

  it("rounds and never goes negative", () => {
    expect(formatDuration(59.6)).toBe("1m 00s");
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("phaseLabel", () => {
  it("translates the core steps into progress phrases", () => {
    expect(phaseLabel("Fetching from GitHub", 0)).toBe("checking the repository");
    expect(phaseLabel("Staging local files", 0)).toBe("staging local files");
    expect(phaseLabel("Exporting sessions", 0)).toBe("exporting sessions");
    expect(phaseLabel("Pushing 2 pending commit(s)", 0)).toBe("sending pending commits");
  });

  it("mentions the shard count while importing", () => {
    expect(phaseLabel("Importing sessions", 912)).toBe("applying 912 sessions");
    expect(phaseLabel("Importing sessions", 1)).toBe("applying 1 session");
    expect(phaseLabel("Importing sessions", 0)).toBe("applying sessions");
  });

  it("falls back to the raw step when it does not recognise it", () => {
    expect(phaseLabel("Something else", 0)).toBe("Something else");
    expect(phaseLabel("", 0)).toBe("syncing");
  });
});
