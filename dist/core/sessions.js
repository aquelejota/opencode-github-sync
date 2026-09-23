import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { ensureDir } from "./fsx.js";
import { SESSIONS_DIR } from "./paths.js";
import { existingTables, openDatabase, tableColumns } from "./sqlite.js";
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
/** Tables whose rows belong to exactly one session. */
const SESSION_TABLES = [
    "session_message",
    "message",
    "part",
    "todo",
    "session_share",
    "session_context_epoch",
    "session_input",
];
function shardPath(repoRoot, sessionId) {
    return path.join(repoRoot, SESSIONS_DIR, `${sanitizeId(sessionId)}.json.gz`);
}
/** Session ids are opaque; keep them filesystem-safe without losing identity. */
export function sanitizeId(id) {
    return id.replace(/[^A-Za-z0-9._-]/g, "_");
}
function readRows(db, sql, params) {
    return db.prepare(sql).all(...params);
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
function canonicalRows(rows) {
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
function canonicalRowKey(row) {
    const id = row.id;
    if (typeof id === "string")
        return id;
    return JSON.stringify(row, Object.keys(row).sort());
}
/**
 * Choose which sessions to export.
 *
 * Explicitly included ids always win, even when they fall outside the window.
 * Everything else must be inside the time window, pass the directory filter and
 * survive the count cap, which keeps the newest sessions.
 */
export function selectSessions(db, options) {
    const now = options.now ?? Date.now();
    const cutoff = now - options.days * 24 * 60 * 60 * 1000;
    const rows = readRows(db, `SELECT id, title, directory, time_updated, time_created, project_id
       FROM session
      ORDER BY time_updated DESC`, []);
    const exclude = new Set(options.exclude);
    const include = new Set(options.include);
    const directories = options.directories.map((d) => path.resolve(d));
    const matchesDirectory = (directory) => {
        if (directories.length === 0)
            return true;
        const resolved = path.resolve(String(directory ?? ""));
        return directories.some((d) => resolved === d || resolved.startsWith(`${d}${path.sep}`));
    };
    const selected = [];
    let windowCount = 0;
    for (const row of rows) {
        const id = String(row.id);
        if (exclude.has(id))
            continue;
        const record = {
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
        if (record.timeUpdated < cutoff)
            continue;
        if (!matchesDirectory(record.directory))
            continue;
        if (windowCount >= options.maxSessions)
            continue;
        windowCount++;
        selected.push(record);
    }
    return selected;
}
function buildShard(db, sessionId, tables) {
    const sessionRow = readRows(db, "SELECT * FROM session WHERE id = ?", [sessionId])[0];
    if (!sessionRow)
        throw new Error(`Session ${sessionId} disappeared while exporting`);
    const shard = {
        formatVersion: 1,
        session: sessionRow,
        tables: {},
        // Derived from the session itself, never wall-clock time. A repeat export
        // of an unchanged session must produce identical bytes, otherwise every
        // push rewrites every shard and import/pull churn is unavoidable.
        exportedAt: Number(sessionRow.time_updated ?? 0),
    };
    const projectId = sessionRow.project_id;
    // `global` is OpenCode's synthetic project row and its worktree/vcs metadata
    // is machine-specific. Shipping it would overwrite the receiving machine's
    // own row on import, and the next export would then see it as changed again.
    if (projectId && projectId !== "global") {
        shard.project = readRows(db, "SELECT * FROM project WHERE id = ?", [projectId])[0];
    }
    const workspaceId = sessionRow.workspace_id;
    if (workspaceId) {
        const rows = readRows(db, "SELECT * FROM workspace WHERE id = ?", [workspaceId]);
        if (rows[0])
            shard.workspace = rows[0];
    }
    for (const table of tables) {
        shard.tables[table] = canonicalRows(readRows(db, `SELECT * FROM "${table}" WHERE session_id = ?`, [sessionId]));
    }
    return shard;
}
/** Export the selected sessions into `<repo>/_sessions`. */
export async function exportSessions(databaseFile, repoRoot, options, reporter) {
    const result = { written: [], unchanged: [], skippedTooLarge: [], considered: 0 };
    if (!fs.existsSync(databaseFile))
        return result;
    const db = await openDatabase(databaseFile, { readOnly: true });
    try {
        const tables = existingTables(db, [...SESSION_TABLES]).filter((table) => tableColumns(db, table).includes("session_id"));
        const sessions = selectSessions(db, options);
        result.considered = sessions.length;
        const outDir = path.join(repoRoot, SESSIONS_DIR);
        ensureDir(outDir);
        const keep = new Set();
        for (const session of sessions) {
            const shard = buildShard(db, session.id, tables);
            const json = Buffer.from(JSON.stringify(shard));
            const file = shardPath(repoRoot, session.id);
            if (fs.existsSync(file) && shardContentEquals(file, json)) {
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
        pruneShards(outDir, keep, options, reporter);
    }
    finally {
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
function pruneShards(outDir, keep, options, reporter) {
    let removed = 0;
    const includeFiles = new Set(options.include.map((id) => `${sanitizeId(id)}.json.gz`));
    for (const entry of fs.readdirSync(outDir)) {
        if (!entry.endsWith(".json.gz"))
            continue;
        if (keep.has(entry) || includeFiles.has(entry))
            continue;
        fs.rmSync(path.join(outDir, entry), { force: true });
        removed++;
    }
    if (removed > 0)
        reporter.detail(`Removed ${removed} session shard(s) outside the retention window`);
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
function shardContentEquals(file, json) {
    let existing;
    try {
        existing = gunzipSync(fs.readFileSync(file));
    }
    catch {
        return false;
    }
    if (existing.equals(json))
        return true;
    try {
        return isDeepStrictEqual(JSON.parse(existing.toString("utf8")), JSON.parse(json.toString("utf8")));
    }
    catch {
        return false;
    }
}
function readShard(file) {
    const raw = gunzipSync(fs.readFileSync(file));
    const shard = JSON.parse(raw.toString("utf8"));
    if (shard.formatVersion !== 1) {
        throw new Error(`Unsupported shard format v${shard.formatVersion}`);
    }
    return shard;
}
function upsert(db, table, row, allowedColumns) {
    const columns = Object.keys(row).filter((column) => allowedColumns.has(column));
    if (columns.length === 0)
        return;
    const placeholders = columns.map(() => "?").join(", ");
    const quoted = columns.map((column) => `"${column}"`).join(", ");
    // A true UPSERT, never INSERT OR REPLACE. REPLACE deletes the conflicting
    // row before inserting the replacement, and deleting a `project` row cascades
    // through `session.project_id -> project.id ON DELETE CASCADE` — silently
    // wiping every session already imported in the same run when shards share a
    // project (they all do: `global`). DO UPDATE never deletes.
    const assignments = columns.map((column) => `"${column}" = excluded."${column}"`).join(", ");
    db.prepare(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ` +
        `ON CONFLICT DO UPDATE SET ${assignments}`).run(...columns.map((column) => normalize(row[column])));
}
/** SQLite drivers accept null/number/string/bigint/Buffer only. */
function normalize(value) {
    if (value === undefined)
        return null;
    if (typeof value === "boolean")
        return value ? 1 : 0;
    if (value !== null && typeof value === "object" && !Buffer.isBuffer(value)) {
        return JSON.stringify(value);
    }
    return value;
}
/** Import every shard from `<repo>/_sessions` into the local database. */
export async function importSessions(databaseFile, repoRoot, reporter) {
    const result = { imported: 0, skippedOlder: 0, failed: [] };
    const shardDir = path.join(repoRoot, SESSIONS_DIR);
    if (!fs.existsSync(shardDir))
        return result;
    const files = fs.readdirSync(shardDir).filter((f) => f.endsWith(".json.gz"));
    if (files.length === 0)
        return result;
    if (!fs.existsSync(databaseFile)) {
        reporter.warn("No local OpenCode database yet — start OpenCode once, then pull again.");
        return result;
    }
    const db = await openDatabase(databaseFile);
    try {
        const columnsFor = new Map();
        const columns = (table) => {
            let set = columnsFor.get(table);
            if (!set) {
                set = new Set(tableColumns(db, table));
                columnsFor.set(table, set);
            }
            return set;
        };
        const localTimes = new Map();
        for (const row of readRows(db, "SELECT id, time_updated FROM session", [])) {
            localTimes.set(String(row.id), Number(row.time_updated ?? 0));
        }
        for (const file of files) {
            const full = path.join(shardDir, file);
            try {
                const shard = readShard(full);
                const sessionId = String(shard.session.id);
                const incoming = Number(shard.session.time_updated ?? 0);
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
                    if (shard.project)
                        upsert(db, "project", shard.project, columns("project"));
                    if (shard.workspace)
                        upsert(db, "workspace", shard.workspace, columns("workspace"));
                    upsert(db, "session", shard.session, columns("session"));
                    for (const [table, rows] of Object.entries(shard.tables)) {
                        if (rows.length === 0)
                            continue;
                        let allowed;
                        try {
                            allowed = columns(table);
                        }
                        catch {
                            continue; // Table does not exist in this OpenCode version.
                        }
                        if (allowed.size === 0)
                            continue;
                        for (const row of rows)
                            upsert(db, table, row, allowed);
                    }
                    db.exec("COMMIT");
                    result.imported++;
                }
                catch (err) {
                    db.exec("ROLLBACK");
                    throw err;
                }
            }
            catch (err) {
                result.failed.push({ file, reason: err.message });
            }
        }
    }
    finally {
        db.close();
    }
    return result;
}
/** List sessions available locally, newest first — powers `sessions list`. */
export async function listSessions(databaseFile, limit) {
    if (!fs.existsSync(databaseFile))
        return [];
    const db = await openDatabase(databaseFile, { readOnly: true });
    try {
        const rows = readRows(db, `SELECT id, title, directory, time_updated, time_created, project_id
         FROM session ORDER BY time_updated DESC LIMIT ?`, [limit]);
        return rows.map((row) => ({
            id: String(row.id),
            title: String(row.title ?? ""),
            directory: String(row.directory ?? ""),
            timeUpdated: Number(row.time_updated ?? 0),
            timeCreated: Number(row.time_created ?? 0),
            projectId: String(row.project_id ?? ""),
        }));
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=sessions.js.map