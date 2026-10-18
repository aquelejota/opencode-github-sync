import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentReporter } from "../src/core/reporter.js";
import {
  exportSessions,
  importSessions,
  listSessions,
  sanitizeId,
  selectSessions,
} from "../src/core/sessions.js";
import type { SessionSettings } from "../src/core/settings.js";
import { openDatabase, sqliteAvailable } from "../src/core/sqlite.js";

/**
 * These tests build a miniature copy of the real OpenCode schema. The column
 * set mirrors what OpenCode actually creates, so a shard produced here has the
 * same shape as one produced from a live database.
 */
const SCHEMA = `
CREATE TABLE project (
  id TEXT PRIMARY KEY, worktree TEXT NOT NULL, name TEXT,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, sandboxes TEXT NOT NULL
);
CREATE TABLE session (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
  directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, workspace_id TEXT,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE TABLE message (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE part (
  id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE todo (
  session_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
  priority TEXT NOT NULL, position INTEGER NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE TABLE event (
  id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, seq INTEGER NOT NULL,
  type TEXT NOT NULL, data TEXT NOT NULL
);
`;

const DAY = 24 * 60 * 60 * 1000;

const settings = (patch: Partial<SessionSettings> = {}): SessionSettings & { now?: number } => ({
  enabled: true,
  days: 7,
  maxSessions: 50,
  maxSessionBytes: 5 * 1024 * 1024,
  include: [],
  exclude: [],
  directories: [],
  ...patch,
});

let root: string;
let available = false;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ogs-sessions-"));
  available = await sqliteAvailable();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

async function makeDatabase(file: string, now: number): Promise<void> {
  const db = await openDatabase(file);
  db.exec(SCHEMA);

  db.prepare(
    "INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?)",
  ).run("prj_1", "/work/app", "app", now, now, "[]");

  const addSession = (id: string, title: string, directory: string, updated: number): void => {
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, "prj_1", id, directory, title, "1.0.0", updated - DAY, updated);
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)",
    ).run(`msg_${id}`, id, updated, updated, JSON.stringify({ role: "user" }));
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)",
    ).run(
      `prt_${id}`,
      `msg_${id}`,
      id,
      updated,
      updated,
      JSON.stringify({ text: `body of ${id}` }),
    );
    db.prepare(
      `INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, "do the thing", "pending", "high", 0, updated, updated);
  };

  addSession("ses_recent", "Recent work", "/work/app", now - 1 * DAY);
  addSession("ses_alsorecent", "Also recent", "/work/other", now - 2 * DAY);
  addSession("ses_old", "Ancient history", "/work/app", now - 90 * DAY);

  db.prepare("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)").run(
    "evt_1",
    "ses_recent",
    1,
    "noise",
    "{}",
  );

  db.close();
}

describe("selectSessions", () => {
  it("keeps sessions inside the window and drops older ones", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeDatabase(file, now);

    const db = await openDatabase(file, { readOnly: true });
    const selected = selectSessions(db, { ...settings(), now });
    db.close();

    expect(selected.map((s) => s.id).sort()).toEqual(["ses_alsorecent", "ses_recent"]);
  });

  it("always keeps explicitly included sessions", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeDatabase(file, now);

    const db = await openDatabase(file, { readOnly: true });
    const selected = selectSessions(db, { ...settings({ include: ["ses_old"] }), now });
    db.close();

    expect(selected.map((s) => s.id)).toContain("ses_old");
  });

  it("honours the exclude list even inside the window", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeDatabase(file, now);

    const db = await openDatabase(file, { readOnly: true });
    const selected = selectSessions(db, { ...settings({ exclude: ["ses_recent"] }), now });
    db.close();

    expect(selected.map((s) => s.id)).not.toContain("ses_recent");
  });

  it("applies the directory filter", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeDatabase(file, now);

    const db = await openDatabase(file, { readOnly: true });
    const selected = selectSessions(db, {
      ...settings({ directories: ["/work/other"] }),
      now,
    });
    db.close();

    expect(selected.map((s) => s.id)).toEqual(["ses_alsorecent"]);
  });

  it("caps how many sessions are selected, keeping the newest", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeDatabase(file, now);

    const db = await openDatabase(file, { readOnly: true });
    const selected = selectSessions(db, { ...settings({ maxSessions: 1 }), now });
    db.close();

    expect(selected.map((s) => s.id)).toEqual(["ses_recent"]);
  });
});

describe("export and import", () => {
  it("round-trips a session into an empty database", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    const exported = await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    expect(exported.written.sort()).toEqual(["ses_alsorecent", "ses_recent"]);
    expect(fs.existsSync(path.join(repo, "_sessions", "ses_recent.json.gz"))).toBe(true);

    const target = path.join(root, "target.sqlite");
    const empty = await openDatabase(target);
    empty.exec(SCHEMA);
    empty.close();

    const result = await importSessions(target, repo, silentReporter);
    expect(result.imported).toBe(2);
    expect(result.failed).toEqual([]);

    const listed = await listSessions(target, 10);
    expect(listed.map((s) => s.id).sort()).toEqual(["ses_alsorecent", "ses_recent"]);

    const db = await openDatabase(target, { readOnly: true });
    const parts = db.prepare("SELECT data FROM part WHERE session_id = ?").all("ses_recent");
    const todos = db.prepare("SELECT content FROM todo WHERE session_id = ?").all("ses_recent");
    const events = db.prepare("SELECT COUNT(*) AS n FROM event").all() as any[];
    db.close();

    expect(parts).toHaveLength(1);
    expect(todos).toHaveLength(1);
    // The runtime event log is intentionally not part of a shard.
    expect(events[0].n).toBe(0);
  });

  it("does not overwrite a session that is newer locally", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);
    await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    const target = path.join(root, "target.sqlite");
    const db = await openDatabase(target);
    db.exec(SCHEMA);
    db.prepare(
      "INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?)",
    ).run("prj_1", "/work/app", "app", now, now, "[]");
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("ses_recent", "prj_1", "s", "/work/app", "Newer local title", "1.0.0", now, now + DAY);
    db.close();

    const result = await importSessions(target, repo, silentReporter);
    expect(result.skippedOlder).toBe(1);

    const check = await openDatabase(target, { readOnly: true });
    const rows = check.prepare("SELECT title FROM session WHERE id = ?").all("ses_recent") as any[];
    check.close();
    expect(rows[0].title).toBe("Newer local title");
  });

  it("skips a session larger than the configured cap", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    const db = await openDatabase(source);
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)",
    ).run("prt_big", "msg_ses_recent", "ses_recent", now, now, "x".repeat(400_000));
    db.close();

    const exported = await exportSessions(
      source,
      repo,
      { ...settings({ maxSessionBytes: 512 }), now },
      silentReporter,
    );

    expect(exported.skippedTooLarge.map((s) => s.id)).toContain("ses_recent");
    expect(fs.existsSync(path.join(repo, "_sessions", "ses_recent.json.gz"))).toBe(false);
  });

  it("keeps every session when shards share one project", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    const target = path.join(root, "target.sqlite");
    const empty = await openDatabase(target);
    empty.exec(SCHEMA);
    empty.close();

    const result = await importSessions(target, repo, silentReporter);
    expect(result.imported).toBe(2);
    expect(result.failed).toEqual([]);

    const db = await openDatabase(target, { readOnly: true });
    const sessions = db.prepare("SELECT id FROM session ORDER BY id").all() as { id: string }[];
    const projects = db.prepare("SELECT id FROM project").all() as { id: string }[];
    db.close();

    // Re-inserting the shared project used to cascade-delete the session that
    // was imported first, leaving only the last one behind.
    expect(projects.map((p) => p.id)).toEqual(["prj_1"]);
    expect(sessions.map((s) => s.id)).toEqual(["ses_alsorecent", "ses_recent"]);
  });

  it("does not export the synthetic global project row", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });

    const db = await openDatabase(source);
    db.exec(SCHEMA);
    db.prepare(
      "INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?)",
    ).run("global", "/machine-specific", "global", now, now, "[]");
    db.prepare(
      `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run("ses_global", "global", "s", "/work/app", "Global", "1.0.0", now - DAY, now);
    db.close();

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    const shard = JSON.parse(
      gunzipSync(fs.readFileSync(path.join(repo, "_sessions", "ses_global.json.gz"))).toString(
        "utf8",
      ),
    );
    expect(shard.session.id).toBe("ses_global");
    expect(shard.project).toBeUndefined();
  });

  it("removes shards that fall out of the retention window", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, "_sessions"), { recursive: true });
    fs.writeFileSync(path.join(repo, "_sessions", "ses_stale.json.gz"), "junk");
    await makeDatabase(source, now);

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    expect(fs.existsSync(path.join(repo, "_sessions", "ses_stale.json.gz"))).toBe(false);
  });

  it("writes byte-identical shards on a repeat export", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    const shard = path.join(repo, "_sessions", "ses_recent.json.gz");
    const before = fs.readFileSync(shard);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    // An unchanged session must not produce a new diff on every push — same
    // bytes, same mtime, no diff for git to pick up.
    expect(fs.readFileSync(shard).equals(before)).toBe(true);
  });

  it("does not rewrite a shard whose content is unchanged but whose bytes differ", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    const shard = path.join(repo, "_sessions", "ses_recent.json.gz");

    // Simulate a shard written by a machine whose zlib produces different
    // compressed bytes for the same JSON: same content, different bytes.
    const content = gunzipSync(fs.readFileSync(shard));
    fs.writeFileSync(shard, gzipSync(content, { level: 1 }));
    const before = fs.readFileSync(shard);

    await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    // Content equality, not byte equality, decides whether to rewrite.
    expect(fs.readFileSync(shard).equals(before)).toBe(true);
  });

  it("exports the same content regardless of the local row order", async () => {
    if (!available) return;
    const now = Date.now();
    const repoA = path.join(root, "repo-a");
    const repoB = path.join(root, "repo-b");
    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });

    const dbA = path.join(root, "a.sqlite");
    const dbB = path.join(root, "b.sqlite");
    await makeDatabase(dbA, now);
    await makeDatabase(dbB, now);

    // Two machines holding the same rows, inserted in opposite orders: the
    // rowids — and therefore the raw SELECT order — differ, the content does
    // not. SQLite has no reason to return them in the same order.
    const addRows = async (file: string, parts: string[], todos: number[]): Promise<void> => {
      const db = await openDatabase(file);
      for (const id of parts) {
        db.prepare(
          "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)",
        ).run(id, "msg_ses_recent", "ses_recent", now, now, JSON.stringify({ text: id }));
      }
      for (const position of todos) {
        db.prepare(
          `INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
           VALUES (?,?,?,?,?,?,?)`,
        ).run("ses_recent", `todo ${position}`, "pending", "high", position, now, now);
      }
      db.close();
    };
    await addRows(dbA, ["prt_aaa", "prt_bbb"], [1, 2]);
    await addRows(dbB, ["prt_bbb", "prt_aaa"], [2, 1]);

    await exportSessions(dbA, repoA, { ...settings(), now }, silentReporter);
    await exportSessions(dbB, repoB, { ...settings(), now }, silentReporter);

    const read = (repo: string): unknown =>
      JSON.parse(
        gunzipSync(fs.readFileSync(path.join(repo, "_sessions", "ses_recent.json.gz"))).toString(
          "utf8",
        ),
      );
    expect(read(repoB)).toEqual(read(repoA));
  });

  it("reports changed and unchanged sessions separately", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    await makeDatabase(source, now);

    const first = await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    expect(first.written.sort()).toEqual(["ses_alsorecent", "ses_recent"]);
    expect(first.unchanged).toEqual([]);

    const second = await exportSessions(source, repo, { ...settings(), now }, silentReporter);
    expect(second.written).toEqual([]);
    expect(second.unchanged.sort()).toEqual(["ses_alsorecent", "ses_recent"]);
  });
});

describe("V2 schema", () => {
  const V2_SCHEMA = `
CREATE TABLE session_v2 (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
  directory TEXT NOT NULL, title TEXT NOT NULL, version TEXT NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, workspace_id TEXT,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE TABLE session_message (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL,
  time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
`;

  async function makeV2Database(file: string, now: number): Promise<void> {
    const db = await openDatabase(file);
    db.exec(SCHEMA + V2_SCHEMA);
    db.prepare(
      "INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?)",
    ).run("prj_1", "/work/app", "app", now, now, "[]");

    const insertV1 = (id: string, updated: number): void => {
      db.prepare(
        `INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, "prj_1", id, "/work/app", `title ${id}`, "1.0.0", updated - DAY, updated);
      db.prepare(
        "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)",
      ).run(`msg_${id}`, id, updated, updated, JSON.stringify({ role: "user" }));
      db.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)",
      ).run(`prt_${id}`, `msg_${id}`, id, updated, updated, JSON.stringify({ text: "legacy" }));
    };
    const insertV2 = (id: string, updated: number, todos = 0): void => {
      db.prepare(
        `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, "prj_1", id, "/work/app", `title ${id}`, "2.0.0", updated - DAY, updated);
      db.prepare(
        `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(`smsg_${id}`, id, "user", 1, updated, updated, JSON.stringify({ text: "v2 body" }));
      // `todo.session_id` still references the legacy `session` table, so only a
      // conversation that also has a legacy row can hold todos.
      for (let position = 0; position < todos; position++) {
        db.prepare(
          `INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated)
           VALUES (?,?,?,?,?,?,?)`,
        ).run(id, "v2 thing", "pending", "high", position, updated, updated);
      }
    };

    // Migrated conversation: complete rows in both families.
    insertV1("ses_migrated", now - DAY);
    insertV2("ses_migrated", now - DAY, 1);
    // Session created natively on V2: only the V2 family has it.
    insertV2("ses_native", now - 2 * DAY);

    db.close();
  }

  const readShardJson = (id: string): any =>
    JSON.parse(
      gunzipSync(fs.readFileSync(path.join(root, "_sessions", `${id}.json.gz`))).toString(),
    );

  it("exports V2 sessions once — session_v2 rows plus session_message — without the legacy tables", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "db.sqlite");
    await makeV2Database(file, now);

    const result = await exportSessions(file, root, { ...settings(), now }, silentReporter);
    expect(result.written.sort()).toEqual(["ses_migrated", "ses_native"]);

    const migrated = readShardJson("ses_migrated");
    expect(migrated.generation).toBe("v2");
    expect(migrated.session.version).toBe("2.0.0");
    expect(migrated.tables.session_message).toHaveLength(1);
    expect(migrated.tables.todo).toHaveLength(1);
    expect(migrated.tables.message).toBeUndefined();
    expect(migrated.tables.part).toBeUndefined();

    const native = readShardJson("ses_native");
    expect(native.generation).toBe("v2");
    expect(native.session.title).toBe("title ses_native");
    expect(native.tables.session_message).toHaveLength(1);
  });

  it("never downgrades a shard already written with generation v2", async () => {
    if (!available) return;
    const now = Date.now();
    const file = path.join(root, "v1.sqlite");
    await makeDatabase(file, now);

    const shardFile = path.join(root, "_sessions", "ses_recent.json.gz");
    fs.mkdirSync(path.dirname(shardFile), { recursive: true });
    const planted = {
      formatVersion: 1,
      generation: "v2",
      session: { id: "ses_recent", time_updated: now - DAY },
      tables: { session_message: [] },
      exportedAt: now - DAY,
    };
    fs.writeFileSync(shardFile, gzipSync(Buffer.from(JSON.stringify(planted))));

    const result = await exportSessions(file, root, { ...settings(), now }, silentReporter);
    expect(result.unchanged).toContain("ses_recent");
    expect(result.written).not.toContain("ses_recent");
    expect(readShardJson("ses_recent").generation).toBe("v2");
  });

  it("skips V2 shards whole when the local database has no session_v2", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "v2.sqlite");
    await makeV2Database(source, now);
    await exportSessions(source, root, { ...settings(), now }, silentReporter);

    const target = path.join(root, "v1.sqlite");
    const db = await openDatabase(target);
    db.exec(SCHEMA);
    db.close();

    const result = await importSessions(target, root, silentReporter);
    expect(result.skippedV2Only).toBe(2);
    expect(result.imported).toBe(0);

    const check = await openDatabase(target, { readOnly: true });
    const count = check.prepare("SELECT COUNT(*) AS n FROM session").all() as any[];
    expect(Number(count[0].n)).toBe(0);
    check.close();
  });

  it("round-trips V2 sessions into an empty V2 database", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "v2.sqlite");
    await makeV2Database(source, now);
    await exportSessions(source, root, { ...settings(), now }, silentReporter);

    const target = path.join(root, "v2-target.sqlite");
    const db = await openDatabase(target);
    db.exec(SCHEMA + V2_SCHEMA);
    db.close();

    const result = await importSessions(target, root, silentReporter);
    expect(result.imported).toBe(2);
    expect(result.skippedV2Only).toBe(0);

    const check = await openDatabase(target, { readOnly: true });
    const session = check
      .prepare("SELECT title FROM session_v2 WHERE id = ?")
      .all("ses_native") as any[];
    expect(session[0]?.title).toBe("title ses_native");
    const messages = check
      .prepare("SELECT COUNT(*) AS n FROM session_message WHERE session_id = ?")
      .all("ses_native") as any[];
    expect(Number(messages[0].n)).toBe(1);
    const legacy = check
      .prepare("SELECT COUNT(*) AS n FROM session WHERE id = ?")
      .all("ses_native") as any[];
    expect(Number(legacy[0].n)).toBe(0);
    check.close();
  });

  it("imports a V2 shard's todos by mirroring the legacy session row (regression)", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "v2.sqlite");
    await makeV2Database(source, now);
    await exportSessions(source, root, { ...settings(), now }, silentReporter);

    // The shard really carries todo rows and they reference the legacy table,
    // so importing it into a V2 database used to fail the foreign key and roll
    // the whole session back (45 sessions lost on 2026-10-17).
    expect(readShardJson("ses_migrated").tables.todo).toHaveLength(1);

    const target = path.join(root, "v2-target.sqlite");
    const db = await openDatabase(target);
    db.exec(SCHEMA + V2_SCHEMA);
    db.close();

    const result = await importSessions(target, root, silentReporter);
    expect(result.failed).toEqual([]);
    expect(result.imported).toBe(2);

    const check = await openDatabase(target, { readOnly: true });
    const todos = check
      .prepare("SELECT COUNT(*) AS n FROM todo WHERE session_id = ?")
      .all("ses_migrated") as any[];
    expect(Number(todos[0].n)).toBe(1);
    const legacy = check
      .prepare("SELECT COUNT(*) AS n FROM session WHERE id = ?")
      .all("ses_migrated") as any[];
    expect(Number(legacy[0].n)).toBe(1);
    // A shard without legacy-referencing tables still writes no legacy row.
    const native = check
      .prepare("SELECT COUNT(*) AS n FROM session WHERE id = ?")
      .all("ses_native") as any[];
    expect(Number(native[0].n)).toBe(0);
    check.close();
  });

  it("keeps last-writer-wins per generation (V2 shard vs session_v2 time)", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "v2.sqlite");
    await makeV2Database(source, now);
    await exportSessions(source, root, { ...settings(), now }, silentReporter);

    const target = path.join(root, "v2-target.sqlite");
    const db = await openDatabase(target);
    db.exec(SCHEMA + V2_SCHEMA);
    db.prepare(
      "INSERT INTO project (id, worktree, name, time_created, time_updated, sandboxes) VALUES (?,?,?,?,?,?)",
    ).run("prj_1", "/work/app", "app", now, now, "[]");
    db.prepare(
      `INSERT INTO session_v2 (id, project_id, slug, directory, title, version, time_created, time_updated)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      "ses_native",
      "prj_1",
      "ses_native",
      "/work/app",
      "local newer",
      "2.0.0",
      now,
      now + 10 * DAY,
    );
    db.close();

    const result = await importSessions(target, root, silentReporter);
    expect(result.skippedOlder).toBe(1);

    const check = await openDatabase(target, { readOnly: true });
    const rows = check
      .prepare("SELECT title FROM session_v2 WHERE id = ?")
      .all("ses_native") as any[];
    expect(rows[0]?.title).toBe("local newer");
    check.close();
  });
});

describe("sanitizeId", () => {
  it("keeps safe ids untouched", () => {
    expect(sanitizeId("ses_065cad1caffeN3lf1RgLZno30")).toBe("ses_065cad1caffeN3lf1RgLZno30");
  });

  it("replaces path separators", () => {
    expect(sanitizeId("a/b\\c")).toBe("a_b_c");
  });
});

// ── Session tombstones (R1) ─────────────────────────────────────────────────
// A deletion made on one machine has to reach the other. The import used to only
// upsert, so the other machine's database kept the row and its next export
// recreated the shard — the session came back.

describe("session tombstones", () => {
  const repoDir = (): string => path.join(root, "repo");
  const shard = (id: string): string =>
    path.join(repoDir(), "_sessions", `${sanitizeId(id)}.json.gz`);
  const marker = (id: string): string =>
    path.join(repoDir(), "_sessions", "_deleted", `${sanitizeId(id)}.json`);

  const writeMarker = (id: string, deletedAt: number): void => {
    fs.mkdirSync(path.dirname(marker(id)), { recursive: true });
    fs.writeFileSync(marker(id), JSON.stringify({ id, deletedAt }));
  };

  /** Delete a session the way the UI does: row plus children. */
  const deleteLocally = async (file: string, id: string): Promise<void> => {
    const db = await openDatabase(file);
    for (const table of ["todo", "part", "message"]) {
      db.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(id);
    }
    db.prepare("DELETE FROM session WHERE id = ?").run(id);
    db.close();
  };

  const count = async (file: string, sql: string, ...params: unknown[]): Promise<number> => {
    const db = await openDatabase(file, { readOnly: true });
    const rows = db.prepare(sql).all(...params) as unknown[];
    db.close();
    return rows.length;
  };

  it("records a marker when a session is gone from the database", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "db.sqlite");
    await makeDatabase(source, now);

    await exportSessions(source, repoDir(), { ...settings(), now }, silentReporter);
    expect(fs.existsSync(marker("ses_recent"))).toBe(false);

    await deleteLocally(source, "ses_recent");
    const again = await exportSessions(
      source,
      repoDir(),
      { ...settings(), now: now + 1000 },
      silentReporter,
    );

    expect(again.tombstoned).toBe(1);
    expect(fs.existsSync(shard("ses_recent"))).toBe(false);
    const written = JSON.parse(fs.readFileSync(marker("ses_recent"), "utf8")) as {
      id: string;
      deletedAt: number;
    };
    expect(written.id).toBe("ses_recent");
    expect(written.deletedAt).toBe(now + 1000);
  });

  it("records no marker for a session that only left the retention window", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "db.sqlite");
    await makeDatabase(source, now);

    await exportSessions(source, repoDir(), { ...settings({ days: 365 }), now }, silentReporter);
    expect(fs.existsSync(shard("ses_old"))).toBe(true);

    const narrowed = await exportSessions(
      source,
      repoDir(),
      { ...settings(), now },
      silentReporter,
    );

    expect(narrowed.tombstoned).toBe(0);
    expect(fs.existsSync(shard("ses_old"))).toBe(false);
    expect(fs.existsSync(path.dirname(marker("ses_old")))).toBe(false);
  });

  it("applies a marker on import: deletes the row and its children, ignores the shard", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "source.sqlite");
    const target = path.join(root, "target.sqlite");
    await makeDatabase(source, now);
    await exportSessions(source, repoDir(), { ...settings(), now }, silentReporter);

    const empty = await openDatabase(target);
    empty.exec(SCHEMA);
    empty.close();
    await importSessions(target, repoDir(), silentReporter);
    expect(await count(target, "SELECT id FROM session WHERE id = ?", "ses_recent")).toBe(1);

    // The marker arrives with the shard still in the repository.
    writeMarker("ses_recent", now + 1000);
    const result = await importSessions(target, repoDir(), silentReporter);

    expect(result.deleted).toBe(1);
    expect(result.skippedTombstoned).toBe(1);
    expect(await count(target, "SELECT id FROM session WHERE id = ?", "ses_recent")).toBe(0);
    for (const table of ["message", "part", "todo"]) {
      expect(await count(target, `SELECT 1 FROM ${table} WHERE session_id = ?`, "ses_recent")).toBe(
        0,
      );
    }
  });

  it("keeps a session resumed after the deletion and drops the marker on export", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "db.sqlite");
    await makeDatabase(source, now);
    await exportSessions(source, repoDir(), { ...settings(), now }, silentReporter);

    // Marker older than the local row: the session was touched after the deletion.
    writeMarker("ses_recent", now - 2 * DAY);
    const imported = await importSessions(source, repoDir(), silentReporter);
    expect(imported.deleted).toBe(0);

    const exported = await exportSessions(
      source,
      repoDir(),
      { ...settings(), now },
      silentReporter,
    );
    expect(exported.revived).toBe(1);
    expect(fs.existsSync(marker("ses_recent"))).toBe(false);
  });

  it("stays deleted after the other machine exports it back", async () => {
    if (!available) return;
    const now = Date.now();
    const machineA = path.join(root, "a.sqlite");
    const machineB = path.join(root, "b.sqlite");
    await makeDatabase(machineA, now);
    await makeDatabase(machineB, now);

    // A publishes, B imports: both know the session.
    await exportSessions(machineA, repoDir(), { ...settings(), now }, silentReporter);
    await importSessions(machineB, repoDir(), silentReporter);

    // A deletes it and publishes the marker (its shard is pruned with it).
    await deleteLocally(machineA, "ses_recent");
    await exportSessions(machineA, repoDir(), { ...settings(), now: now + 1000 }, silentReporter);

    // B still has the row; its export must honour the marker instead of
    // republishing the session.
    const fromB = await exportSessions(
      machineB,
      repoDir(),
      { ...settings(), now: now + 2000 },
      silentReporter,
    );
    expect(fromB.written).not.toContain("ses_recent");
    expect(fs.existsSync(shard("ses_recent"))).toBe(false);

    // A pulls again: nothing comes back.
    const backAtA = await importSessions(machineA, repoDir(), silentReporter);
    expect(backAtA.imported).toBe(0);
    expect(await count(machineA, "SELECT id FROM session WHERE id = ?", "ses_recent")).toBe(0);

    // B applies the marker on its next pull.
    const appliedAtB = await importSessions(machineB, repoDir(), silentReporter);
    expect(appliedAtB.deleted).toBe(1);
    expect(await count(machineB, "SELECT id FROM session WHERE id = ?", "ses_recent")).toBe(0);
  });
});

describe("session tombstones × generations", () => {
  it("a V1 database neither tombsstones nor removes V2 shards it cannot read", async () => {
    if (!available) return;
    const now = Date.now();
    const source = path.join(root, "v1.sqlite");
    const repo = path.join(root, "repo");
    await makeDatabase(source, now);

    // A V2 shard for a session this (V1) database cannot import.
    const v2Shard = {
      formatVersion: 1,
      generation: "v2",
      exportedAt: now,
      session: { id: "ses_v2only", project_id: "prj_1", time_created: now, time_updated: now },
      tables: {},
    };
    const dir = path.join(repo, "_sessions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "ses_v2only.json.gz"),
      gzipSync(Buffer.from(JSON.stringify(v2Shard))),
    );

    const result = await exportSessions(source, repo, { ...settings(), now }, silentReporter);

    expect(result.tombstoned).toBe(0);
    expect(fs.existsSync(path.join(dir, "ses_v2only.json.gz"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "_deleted", "ses_v2only.json"))).toBe(false);
  });
});
