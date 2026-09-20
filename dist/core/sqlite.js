/**
 * Minimal SQLite adapter.
 *
 * OpenCode stores every session in a single SQLite database. We need to read
 * and write it without dragging in a native dependency, because this package is
 * loaded inside the OpenCode runtime where a compiled addon would have to match
 * whatever engine the user happens to be running.
 *
 * Two built-in drivers are supported, in preference order:
 *   1. `bun:sqlite`  — present when OpenCode runs the plugin under Bun
 *   2. `node:sqlite` — Node 22.5+
 *
 * Neither requires an install step. When neither is available session sync is
 * disabled with a clear message rather than failing halfway through.
 */
import { createRequire } from "node:module";
/**
 * Built from parts so bundlers and TypeScript never try to resolve the Bun
 * built-in at build time. It only ever exists inside the Bun runtime.
 */
const BUN_SQLITE = ["bun", "sqlite"].join(":");
async function importBunSqlite() {
    return import(/* @vite-ignore */ /* webpackIgnore: true */ BUN_SQLITE);
}
/**
 * Load the Node built-in SQLite driver.
 *
 * The plain dynamic import is what works under Node and Bun. Test runners such
 * as vitest intercept dynamic imports and try to resolve `node:sqlite` as a
 * project file, which makes the driver undetectable and silently turns every
 * session test into an early return. `createRequire` bypasses the bundler and
 * loads the real builtin, so those tests actually run.
 */
async function importNodeSqlite() {
    try {
        return await import("node:sqlite");
    }
    catch {
        return createRequire(import.meta.url)("node:sqlite");
    }
}
let cachedDriver;
async function detectDriver() {
    if (cachedDriver)
        return cachedDriver;
    if (typeof globalThis.Bun !== "undefined") {
        try {
            await importBunSqlite();
            cachedDriver = "bun";
            return cachedDriver;
        }
        catch {
            // Fall through to the Node driver.
        }
    }
    try {
        const mod = await importNodeSqlite();
        if (mod?.DatabaseSync) {
            cachedDriver = "node";
            return cachedDriver;
        }
    }
    catch {
        // Not available on this runtime.
    }
    cachedDriver = "none";
    return cachedDriver;
}
export class SqliteUnavailableError extends Error {
    constructor() {
        super("Session sync needs SQLite support. Run OpenCode under Bun, or use Node 22.5 or newer.\n" +
            "Configuration sync works without it — only `sessions` is affected.");
        this.name = "SqliteUnavailableError";
    }
}
export async function sqliteAvailable() {
    return (await detectDriver()) !== "none";
}
export async function openDatabase(file, options = {}) {
    const driver = await detectDriver();
    if (driver === "bun") {
        const { Database } = await importBunSqlite();
        const db = new Database(file, options.readOnly ? { readonly: true } : { create: true });
        return {
            prepare: (sql) => {
                const stmt = db.prepare(sql);
                return {
                    all: (...params) => stmt.all(...params),
                    run: (...params) => stmt.run(...params),
                };
            },
            exec: (sql) => db.exec(sql),
            close: () => db.close(),
        };
    }
    if (driver === "node") {
        const { DatabaseSync } = (await importNodeSqlite());
        const db = new DatabaseSync(file, options.readOnly ? { readOnly: true } : {});
        return {
            prepare: (sql) => {
                const stmt = db.prepare(sql);
                return {
                    all: (...params) => stmt.all(...params),
                    run: (...params) => stmt.run(...params),
                };
            },
            exec: (sql) => db.exec(sql),
            close: () => db.close(),
        };
    }
    throw new SqliteUnavailableError();
}
/** Which of the given tables actually exist in this database. */
export function existingTables(db, candidates) {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const present = new Set(rows.map((r) => r.name));
    return candidates.filter((name) => present.has(name));
}
/** Column names of a table, in declaration order. */
export function tableColumns(db, table) {
    const rows = db.prepare(`PRAGMA table_info("${table}")`).all();
    return rows.map((r) => r.name);
}
//# sourceMappingURL=sqlite.js.map