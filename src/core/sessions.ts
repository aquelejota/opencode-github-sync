import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { ensureDir } from "./fsx.js";
import { SESSIONS_DIR } from "./paths.js";
import type { Reporter } from "./reporter.js";
import type { SessionSettings } from "./settings.js";
import { type SqliteDatabase, existingTables, openDatabase, tableColumns } from "./sqlite.js";

/**
 * Selective session sync.
 *
 * The naive approach — commit `opencode.db` — stops working almost immediately.
 * A real database reaches several gigabytes, dominated by tool output stored in
 * `part.data`, and Git has no way to delta-compress it. Worse, copying a live
 * database together with its write-ahead log can capture a torn state that only
 * reveals itself much later.
 *
 * So sessions are exported one at a time. Each session becomes an independent,
 * gzipped JSON shard containing its own rows plus the project and workspace
 * rows it depends on. That buys three things:
 *
 *   - **No large files.** Shards are individually small and compress well.
 *   - **Conflict isolation.** Two machines editing different sessions touch
 *     different files, so Git merges them without any special handling. The
 *     only true conflict is the same session edited in two places, where the
 *     newer `time_updated` wins.
 *   - **Selectivity.** A time window, an explicit include list, a project
 *     filter and a per-session size cap decide what travels. Ancient sessions
 *     stay on the machine that created them.
 *
 * Import is an upsert inside a transaction, so a failure leaves the local
 * database exactly as it was.
 */

/**
 * Tables whose rows belong to exactly one session, per schema generation.
 *
 * An OpenCode 2 database keeps the legacy V1 tables (`session`, `message`,
 * `part`) next to its own (`session_v2`, `session_message`), and every migrated
 * conversation is stored in both. Exporting both families in one shard doubled
 * the payload (~608 MB across the repo on 2026-10-16) and broke the push, so an
 * export ships exactly one family — the one its database actually uses.
 */
const V1_SESSION_TABLES = [
  "message",
  "part",
  "todo",
  "session_share",
  "session_context_epoch",
  "session_input",
] as const;

const V2_SESSION_TABLES = [
  "session_message",
  "todo",
  "session_share",
  "session_context_epoch",
  "session_input",
] as const;

const V1_SESSION_TABLE = "session";
const V2_SESSION_TABLE = "session_v2";

/**
 * Tables whose `session_id` still references the legacy `session` table even on
 * an OpenCode 2 database (`todo`, `session_share`). They are exported with every
 * shard, so a V2 shard that carries them needs a row in `session` too.
 */
const LEGACY_SESSION_REFERENCING_TABLES = ["todo", "session_share"] as const;

/** Whether the shard carries rows for a table that references legacy `session`. */
function referencesLegacySession(tables: Record<string, Record<string, unknown>[]>): boolean {
  return LEGACY_SESSION_REFERENCING_TABLES.some((table) => (tables[table]?.length ?? 0) > 0);
}

/** Session rows live in `session_v2` once the database has the V2 schema. */
function sessionTableFor(db: SqliteDatabase): string {
  return existingTables(db, [V2_SESSION_TABLE]).length > 0 ? V2_SESSION_TABLE : V1_SESSION_TABLE;
}

/**
 * `event` and `event_sequence` are deliberately excluded. They are an internal
 * append-only runtime log, they dwarf everything else in row count, and nothing
 * about resuming a conversation on another machine depends on them.
 */

export interface SessionRecord {
  id: string;
  title: string;
  directory: string;
  timeUpdated: number;
  timeCreated: number;
  projectId: string;
}

export interface SessionShard {
  formatVersion: 1;
  session: Record<string, unknown>;
  project?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
  exportedAt: number;
  /**
   * Present only on shards produced from an OpenCode 2 database. The field is
   * additive, so V1 readers that predate it simply ignore it; readers that know
   * it use it to route the session row (`session` vs `session_v2`), to refuse
   * V2-only shards on a V1 database, and to never downgrade a V2 shard.
   */
  generation?: "v2";
}

export interface SelectOptions extends SessionSettings {
  now?: number;
}

export interface ExportResult {
  /** Sessions whose shard was written or rewritten. */
  written: string[];
  /** Sessions whose shard on disk already had this exact content. */
  unchanged: string[];
  skippedTooLarge: { id: string; title: string; bytes: number }[];
  /** Deletion markers written because the session is gone from the database. */
  tombstoned: number;
  /** Markers dropped because the session was resumed after being deleted. */
  revived: number;
  considered: number;
}

export interface ImportResult {
  imported: number;
  skippedOlder: number;
  /** V2 shards skipped whole because the local database has no `session_v2`. */
  skippedV2Only: number;
  /** Local sessions deleted because another machine deleted them. */
  deleted: number;
  /** Shards ignored because their session is tombstoned and not newer. */
  skippedTombstoned: number;
  failed: { file: string; reason: string }[];
}

function shardPath(repoRoot: string, sessionId: string): string {
  return path.join(repoRoot, SESSIONS_DIR, `${sanitizeId(sessionId)}.json.gz`);
}

/** Session ids are opaque; keep them filesystem-safe without losing identity. */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** Folder inside the shard directory where deletion markers live. */
const TOMBSTONE_DIR = "_deleted";

/** A deletion marker: "this session was deleted on some machine at `deletedAt`". */
export interface Tombstone {
  id: string;
  deletedAt: number;
}

function tombstonesDir(repoRoot: string): string {
  return path.join(repoRoot, SESSIONS_DIR, TOMBSTONE_DIR);
}

function tombstonePath(repoRoot: string, sessionId: string): string {
  return path.join(tombstonesDir(repoRoot), `${sanitizeId(sessionId)}.json`);
}

/**
 * Read every deletion marker in `<repo>/_sessions/_deleted`.
 *
 * The export writes a marker when a shard disappears because the session is gone
 * from the local database — not when it only left the retention window. The
 * import applies it, which is what makes a deletion travel: the import used to
 * only upsert, so a session deleted on one machine came back from the other
 * machine's next export (its database still had the row).
 */
export function readTombstones(repoRoot: string): Map<string, number> {
  const dir = tombstonesDir(repoRoot);
  const tombstones = new Map<string, number>();
  if (!fs.existsSync(dir)) return tombstones;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, entry), "utf8"),
      ) as Partial<Tombstone>;
      if (typeof parsed?.id === "string" && Number.isFinite(parsed.deletedAt)) {
        tombstones.set(parsed.id, Number(parsed.deletedAt));
      }
    } catch {
      // A malformed marker must never block a sync.
    }
  }
  return tombstones;
}

/** Write the marker unless one already exists — the first deletion wins. */
function writeTombstone(repoRoot: string, sessionId: string, deletedAt: number): boolean {
  const file = tombstonePath(repoRoot, sessionId);
  if (fs.existsSync(file)) return false;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify({ id: sessionId, deletedAt }, null, 2)}\n`);
  return true;
}

function removeTombstone(repoRoot: string, sessionId: string): boolean {
  const file = tombstonePath(repoRoot, sessionId);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function readRows(db: SqliteDatabase, sql: string, params: unknown[]): Record<string, unknown>[] {
  return db.prepare(sql).all(...params) as Record<string, unknown>[];
}

/**
 * Put a table's rows in a stable order that does not depend on local rowids.
 *
 * SQLite returns rows in rowid order unless the query says otherwise, and
 * rowids are a per-machine insertion artifact: two machines holding the same
 * rows serialize the same JSON in different array orders. The shard comparison
 * is positional (arrays are ordered), so each machine used to rewrite the
 * other's shards on every alternation. Sorting by a value derived from the row
 * itself makes the export deterministic everywhere.
 */
function canonicalRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const left = canonicalRowKey(a);
    const right = canonicalRowKey(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Ids sort naturally; tables without one (`todo`, `session_context_epoch`) fall
 * back to their canonical JSON, keys sorted, so the local schema's column order
 * never leaks into the comparison.
 */
function canonicalRowKey(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id === "string") return id;
  return JSON.stringify(row, Object.keys(row).sort());
}

/**
 * Choose which sessions to export.
 *
 * Explicitly included ids always win, even when they fall outside the window.
 * Everything else must be inside the time window, pass the directory filter and
 * survive the count cap, which keeps the newest sessions.
 */
export function selectSessions(db: SqliteDatabase, options: SelectOptions): SessionRecord[] {
  const now = options.now ?? Date.now();
  const cutoff = now - options.days * 24 * 60 * 60 * 1000;
  const table = sessionTableFor(db);

  const rows = readRows(
    db,
    `SELECT id, title, directory, time_updated, time_created, project_id
       FROM "${table}"
      ORDER BY time_updated DESC`,
    [],
  ) as any[];

  const exclude = new Set(options.exclude);
  const include = new Set(options.include);
  const directories = options.directories.map((d) => path.resolve(d));

  const matchesDirectory = (directory: string): boolean => {
    if (directories.length === 0) return true;
    const resolved = path.resolve(String(directory ?? ""));
    return directories.some((d) => resolved === d || resolved.startsWith(`${d}${path.sep}`));
  };

  const selected: SessionRecord[] = [];
  let windowCount = 0;

  for (const row of rows) {
    const id = String(row.id);
    if (exclude.has(id)) continue;

    const record: SessionRecord = {
      id,
      title: String(row.title ?? ""),
      directory: String(row.directory ?? ""),
      timeUpdated: Number(row.time_updated ?? 0),
      timeCreated: Number(row.time_created ?? 0),
      projectId: String(row.project_id ?? ""),
    };

    if (include.has(id)) {
      selected.push(record);
      continue;
    }
    if (record.timeUpdated < cutoff) continue;
    if (!matchesDirectory(record.directory)) continue;
    if (windowCount >= options.maxSessions) continue;

    windowCount++;
    selected.push(record);
  }

  return selected;
}

function buildShard(
  db: SqliteDatabase,
  sessionId: string,
  tables: string[],
  sessionTable: string,
): SessionShard {
  const sessionRow = readRows(db, `SELECT * FROM "${sessionTable}" WHERE id = ?`, [sessionId])[0];
  if (!sessionRow) throw new Error(`Session ${sessionId} disappeared while exporting`);

  const shard: SessionShard = {
    formatVersion: 1,
    session: sessionRow,
    tables: {},
    // Derived from the session itself, never wall-clock time. A repeat export
    // of an unchanged session must produce identical bytes, otherwise every
    // push rewrites every shard and import/pull churn is unavoidable.
    exportedAt: Number(sessionRow.time_updated ?? 0),
  };
  if (sessionTable === V2_SESSION_TABLE) shard.generation = "v2";

  const projectId = sessionRow.project_id;
  // `global` is OpenCode's synthetic project row and its worktree/vcs metadata
  // is machine-specific. Shipping it would overwrite the receiving machine's
  // own row on import, and the next export would then see it as changed again.
  if (projectId && projectId !== "global") {
    shard.project = readRows(db, "SELECT * FROM project WHERE id = ?", [projectId])[0];
  }
  const workspaceId = (sessionRow as any).workspace_id;
  if (workspaceId) {
    const rows = readRows(db, "SELECT * FROM workspace WHERE id = ?", [workspaceId]);
    if (rows[0]) shard.workspace = rows[0];
  }

  for (const table of tables) {
    shard.tables[table] = canonicalRows(
      readRows(db, `SELECT * FROM "${table}" WHERE session_id = ?`, [sessionId]),
    );
  }

  return shard;
}

/** Export the selected sessions into `<repo>/_sessions`. */
export async function exportSessions(
  databaseFile: string,
  repoRoot: string,
  options: SelectOptions,
  reporter: Reporter,
): Promise<ExportResult> {
  const result: ExportResult = {
    written: [],
    unchanged: [],
    skippedTooLarge: [],
    tombstoned: 0,
    revived: 0,
    considered: 0,
  };
  if (!fs.existsSync(databaseFile)) return result;

  const db = await openDatabase(databaseFile, { readOnly: true });
  try {
    const sessionTable = sessionTableFor(db);
    const v2 = sessionTable === V2_SESSION_TABLE;
    const tables = existingTables(db, [...(v2 ? V2_SESSION_TABLES : V1_SESSION_TABLES)]).filter(
      (table) => tableColumns(db, table).includes("session_id"),
    );
    const sessions = selectSessions(db, options);
    result.considered = sessions.length;

    const tombstones = readTombstones(repoRoot);
    const deletedAt = options.now ?? Date.now();
    // Ids that still exist locally (both schema families). A shard whose id is
    // missing here was deleted, not merely aged out of the retention window.
    const localIds = new Set<string>();
    for (const table of existingTables(db, [V1_SESSION_TABLE, V2_SESSION_TABLE])) {
      for (const row of readRows(db, `SELECT id FROM "${table}"`, [])) {
        localIds.add(String(row.id));
      }
    }

    const outDir = path.join(repoRoot, SESSIONS_DIR);
    ensureDir(outDir);

    const keep = new Set<string>();

    for (const session of sessions) {
      const tombstone = tombstones.get(session.id);
      if (tombstone !== undefined) {
        if (tombstone >= session.timeUpdated) {
          // Deleted on another machine and untouched since: never republish it.
          continue;
        }
        // Resumed after the deletion — the live work wins over the marker.
        if (removeTombstone(repoRoot, session.id)) result.revived++;
      }

      const shard = buildShard(db, session.id, tables, sessionTable);
      const json = Buffer.from(JSON.stringify(shard));
      const file = shardPath(repoRoot, session.id);
      const existing = fs.existsSync(file) ? readShardInfo(file) : undefined;

      // Never downgrade: a V1 machine re-exporting a session a V2 machine
      // already wrote would rewrite the shard forever (each side sees the
      // other's bytes as different) and strip the V2 data it carries.
      if (existing?.generation === "v2" && !v2) {
        keep.add(path.basename(file));
        result.unchanged.push(session.id);
        continue;
      }

      if (existing && shardContentEquals(existing.json, json)) {
        keep.add(path.basename(file));
        result.unchanged.push(session.id);
        continue;
      }

      // Compressing is the expensive half of an export, so it only happens
      // when the shard is actually going to be written.
      const payload = gzipSync(json, { level: 9 });
      if (payload.byteLength > options.maxSessionBytes) {
        result.skippedTooLarge.push({
          id: session.id,
          title: session.title,
          bytes: payload.byteLength,
        });
        continue;
      }

      keep.add(path.basename(file));
      fs.writeFileSync(file, payload);
      result.written.push(session.id);
    }

    pruneShards(outDir, keep, options, reporter, {
      localIds,
      localV2: v2,
      now: deletedAt,
      onTombstone: () => {
        result.tombstoned++;
      },
    });
  } finally {
    db.close();
  }

  return result;
}

/**
 * Delete shards that no longer qualify.
 *
 * A shard is removed when it is outside the retention window, so the repository
 * does not accumulate every session ever synced. Shards for explicitly included
 * sessions are always kept.
 */
function pruneShards(
  outDir: string,
  keep: Set<string>,
  options: SelectOptions,
  reporter: Reporter,
  state: {
    localIds: Set<string>;
    localV2: boolean;
    now: number;
    onTombstone: () => void;
  },
): void {
  let removed = 0;
  let tombstoned = 0;
  const includeFiles = new Set(options.include.map((id) => `${sanitizeId(id)}.json.gz`));
  const repoRoot = path.dirname(outDir);
  for (const entry of fs.readdirSync(outDir)) {
    if (!entry.endsWith(".json.gz")) continue;
    if (keep.has(entry)) continue;
    const file = path.join(outDir, entry);
    const info = readShardInfo(file);
    // A V1 machine cannot read V2 shards, so it must neither tombstone nor
    // remove them — "never downgrade" applies to untouched shards too.
    if (info?.generation === "v2" && !state.localV2) continue;
    const id = readShardId(file);
    // Ids absent from the database are deletions (by the user or the UI), not
    // retention: record a marker so the other machine deletes them too.
    if (id !== undefined && !state.localIds.has(id) && writeTombstone(repoRoot, id, state.now)) {
      tombstoned++;
      state.onTombstone();
    }
    // `include` keeps existing sessions beyond the window, but can never
    // resurrect a deleted one.
    if (id !== undefined && state.localIds.has(id) && includeFiles.has(entry)) continue;
    fs.rmSync(file, { force: true });
    removed++;
  }
  if (removed > 0)
    reporter.detail(`Removed ${removed} session shard(s) (retention window or deleted locally)`);
  if (tombstoned > 0) reporter.detail(`Recorded ${tombstoned} session deletion(s)`);
}

/** The session id inside a shard, for shards about to be pruned. */
function readShardId(file: string): string | undefined {
  const info = readShardInfo(file);
  if (!info) return undefined;
  try {
    const shard = JSON.parse(info.json.toString("utf8")) as { session?: { id?: unknown } };
    return typeof shard?.session?.id === "string" ? shard.session.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when the shard on disk already holds this exact content.
 *
 * Compressed bytes are a poor identity: two machines, or two zlib builds,
 * produce different gzip output for the same JSON. Comparing those bytes used
 * to rewrite every shard on every export, turning each push into a
 * whole-repository diff. The fast path compares the uncompressed bytes; when
 * those differ, a deep compare still rules out a mere key-order difference.
 */
function shardContentEquals(existing: Buffer, json: Buffer): boolean {
  if (existing.equals(json)) return true;
  try {
    return isDeepStrictEqual(
      JSON.parse(existing.toString("utf8")),
      JSON.parse(json.toString("utf8")),
    );
  } catch {
    return false;
  }
}

/** Uncompressed bytes plus the generation marker of an on-disk shard. */
function readShardInfo(file: string): { json: Buffer; generation?: string } | undefined {
  try {
    const json = gunzipSync(fs.readFileSync(file));
    const parsed = JSON.parse(json.toString("utf8")) as { generation?: unknown };
    return {
      json,
      generation: typeof parsed?.generation === "string" ? parsed.generation : undefined,
    };
  } catch {
    return undefined;
  }
}

function readShard(file: string): SessionShard {
  const raw = gunzipSync(fs.readFileSync(file));
  const shard = JSON.parse(raw.toString("utf8")) as SessionShard;
  if (shard.formatVersion !== 1) {
    throw new Error(`Unsupported shard format v${shard.formatVersion}`);
  }
  return shard;
}

function upsert(
  db: SqliteDatabase,
  table: string,
  row: Record<string, unknown>,
  allowedColumns: Set<string>,
): void {
  const columns = Object.keys(row).filter((column) => allowedColumns.has(column));
  if (columns.length === 0) return;
  const placeholders = columns.map(() => "?").join(", ");
  const quoted = columns.map((column) => `"${column}"`).join(", ");
  // A true UPSERT, never INSERT OR REPLACE. REPLACE deletes the conflicting
  // row before inserting the replacement, and deleting a `project` row cascades
  // through `session.project_id -> project.id ON DELETE CASCADE` — silently
  // wiping every session already imported in the same run when shards share a
  // project (they all do: `global`). DO UPDATE never deletes.
  const assignments = columns.map((column) => `"${column}" = excluded."${column}"`).join(", ");
  db.prepare(
    `INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ` +
      `ON CONFLICT DO UPDATE SET ${assignments}`,
  ).run(...columns.map((column) => normalize(row[column])));
}

/** SQLite drivers accept null/number/string/bigint/Buffer only. */
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Import every shard from `<repo>/_sessions` into the local database.
 *
 * Shards written by an OpenCode 2 machine (`generation: "v2"`) land in the V2
 * tables and are skipped whole when the local database is still V1. Shards
 * without the marker keep the original V1 behavior.
 */
export async function importSessions(
  databaseFile: string,
  repoRoot: string,
  reporter: Reporter,
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    skippedOlder: 0,
    skippedV2Only: 0,
    deleted: 0,
    skippedTombstoned: 0,
    failed: [],
  };
  const shardDir = path.join(repoRoot, SESSIONS_DIR);
  if (!fs.existsSync(shardDir)) return result;

  const tombstones = readTombstones(repoRoot);
  const files = fs.readdirSync(shardDir).filter((f) => f.endsWith(".json.gz"));
  // A marker deletes a row, so a pull that only brings a marker still has work.
  if (files.length === 0 && tombstones.size === 0) return result;
  if (!fs.existsSync(databaseFile)) {
    reporter.warn("No local OpenCode database yet — start OpenCode once, then pull again.");
    return result;
  }

  const db = await openDatabase(databaseFile);
  try {
    const columnsFor = new Map<string, Set<string>>();
    const columns = (table: string): Set<string> => {
      let set = columnsFor.get(table);
      if (!set) {
        set = new Set(tableColumns(db, table));
        columnsFor.set(table, set);
      }
      return set;
    };

    const localSessionTable = sessionTableFor(db);
    const hasLegacySessionTable = existingTables(db, [V1_SESSION_TABLE]).length > 0;
    // Last-writer-wins is evaluated per generation: a V2 shard is compared
    // against `session_v2`, a legacy shard against `session`. V2 shards are
    // skipped whole on a V1 database — a legacy reader must never store a
    // session row whose messages it cannot import.
    const localTimes = new Map<string, number>();
    for (const row of readRows(
      db,
      `SELECT id, time_updated FROM "${localSessionTable}"`,
      [],
    ) as any[]) {
      localTimes.set(String(row.id), Number(row.time_updated ?? 0));
    }

    // Applying a deletion removes children first: the import never relies on
    // SQLite's ON DELETE CASCADE being enabled in this connection.
    const childTables = existingTables(db, [...V1_SESSION_TABLES, ...V2_SESSION_TABLES]).filter(
      (table) => tableColumns(db, table).includes("session_id"),
    );
    const familyTables = existingTables(db, [V1_SESSION_TABLE, V2_SESSION_TABLE]);
    const deleteSession = (sessionId: string): void => {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of childTables) {
          db.prepare(`DELETE FROM "${table}" WHERE session_id = ?`).run(sessionId);
        }
        for (const table of familyTables) {
          db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(sessionId);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    };
    const seen = new Set<string>();

    for (const file of files) {
      const full = path.join(shardDir, file);
      try {
        const shard = readShard(full);
        const sessionId = String(shard.session.id);
        const incoming = Number(shard.session.time_updated ?? 0);
        const shardV2 = shard.generation === "v2";
        seen.add(sessionId);

        const tombstone = tombstones.get(sessionId);
        if (tombstone !== undefined && incoming <= tombstone) {
          // Deleted on another machine and this shard is not newer: the deletion
          // wins (a resumed session updates `time_updated`, so it would win here).
          if (localTimes.has(sessionId)) {
            deleteSession(sessionId);
            localTimes.delete(sessionId);
            result.deleted++;
          }
          result.skippedTombstoned++;
          continue;
        }

        if (shardV2 && localSessionTable !== V2_SESSION_TABLE) {
          result.skippedV2Only++;
          continue;
        }

        const local = localTimes.get(sessionId);

        // Last-writer-wins at session granularity. A session that is newer
        // locally is left completely alone, so an in-progress conversation is
        // never clobbered by a stale copy from another machine.
        if (local !== undefined && local >= incoming) {
          result.skippedOlder++;
          continue;
        }

        db.exec("BEGIN IMMEDIATE");
        try {
          if (shard.project) upsert(db, "project", shard.project, columns("project"));
          if (shard.workspace) upsert(db, "workspace", shard.workspace, columns("workspace"));
          const sessionTable = shardV2 ? V2_SESSION_TABLE : V1_SESSION_TABLE;
          upsert(db, sessionTable, shard.session, columns(sessionTable));
          // An OpenCode 2 database keeps the legacy `session` table next to
          // `session_v2`, and `todo`/`session_share` still point at the legacy
          // one. A V2 shard carrying those rows is therefore rolled back whole
          // by the foreign key unless the legacy row exists as well — which is
          // also how OpenCode stores a migrated conversation (in both tables).
          if (shardV2 && hasLegacySessionTable && referencesLegacySession(shard.tables)) {
            upsert(db, V1_SESSION_TABLE, shard.session, columns(V1_SESSION_TABLE));
          }

          for (const [table, rows] of Object.entries(shard.tables)) {
            if (rows.length === 0) continue;
            let allowed: Set<string>;
            try {
              allowed = columns(table);
            } catch {
              continue; // Table does not exist in this OpenCode version.
            }
            if (allowed.size === 0) continue;
            for (const row of rows) upsert(db, table, row, allowed);
          }
          db.exec("COMMIT");
          result.imported++;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      } catch (err) {
        result.failed.push({ file, reason: (err as Error).message });
      }
    }

    // Markers whose shard is not in this pull — the usual case: the machine that
    // deleted the session also pruned the shard, so nothing else carries the id.
    for (const [sessionId, deletedAt] of tombstones) {
      if (seen.has(sessionId)) continue;
      const local = localTimes.get(sessionId);
      if (local === undefined || local > deletedAt) continue;
      try {
        deleteSession(sessionId);
        localTimes.delete(sessionId);
        result.deleted++;
      } catch (err) {
        result.failed.push({ file: `tombstone:${sessionId}`, reason: (err as Error).message });
      }
    }
  } finally {
    db.close();
  }

  return result;
}

/** List sessions available locally, newest first — powers `sessions list`. */
export async function listSessions(databaseFile: string, limit: number): Promise<SessionRecord[]> {
  if (!fs.existsSync(databaseFile)) return [];
  const db = await openDatabase(databaseFile, { readOnly: true });
  try {
    const table = sessionTableFor(db);
    const rows = readRows(
      db,
      `SELECT id, title, directory, time_updated, time_created, project_id
         FROM "${table}" ORDER BY time_updated DESC LIMIT ?`,
      [limit],
    ) as any[];
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      directory: String(row.directory ?? ""),
      timeUpdated: Number(row.time_updated ?? 0),
      timeCreated: Number(row.time_created ?? 0),
      projectId: String(row.project_id ?? ""),
    }));
  } finally {
    db.close();
  }
}
